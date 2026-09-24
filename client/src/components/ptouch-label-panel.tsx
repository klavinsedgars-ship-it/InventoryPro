import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, FileDown, Trash2, AlertTriangle } from "lucide-react";

/**
 * Labels through P-touch Editor.
 *
 * The QL-800 rejects a browser print job whose media is not the roll on the
 * spool, and on this machine only P-touch drives it properly. So the CRM fills
 * in the operator's own label instead of trying to be the printer: upload the
 * .lbx once, and every order hands back that same file with the address in it.
 */

interface TemplateInfo {
  present: boolean;
  broken?: boolean;
  error?: string;
  name?: string;
  slot?: number;
  slots?: { index: number; preview: string }[];
  bytes?: number;
  updatedAt?: string | null;
}

interface PtouchLabelPanelProps {
  orderId: number;
  orderRef: string;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Chunked, because a 100 KB spread onto the argument list blows the stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function PtouchLabelPanel({ orderId, orderRef }: PtouchLabelPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "download" | "remove" | null>(null);

  const { data: template, isLoading } = useQuery<TemplateInfo>({
    queryKey: ["/api/labels/template"],
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/labels/template"] });

  const handleUpload = async (file: File) => {
    setBusy("upload");
    try {
      const dataBase64 = await fileToBase64(file);
      await apiRequest("POST", "/api/labels/template", { name: file.name, dataBase64 });
      await refresh();
      toast({ title: "Template saved", description: `${file.name} will be filled in for every order.` });
    } catch (err: any) {
      toast({
        title: "Could not read that .lbx",
        description: String(err?.message ?? err).replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDownload = async () => {
    setBusy("download");
    try {
      const res = await fetch(`/api/orders/${orderId}/label.lbx`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status} ${res.statusText}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `label-${orderRef}.lbx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the download in Safari.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err: any) {
      toast({
        title: "Could not build the label",
        description: String(err?.message ?? err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleSlot = async (value: string) => {
    try {
      await apiRequest("POST", "/api/labels/template/slot", { slot: Number(value) });
      await refresh();
    } catch (err: any) {
      toast({ title: "Could not change the text box", description: String(err?.message ?? err), variant: "destructive" });
    }
  };

  const handleRemove = async () => {
    setBusy("remove");
    try {
      await apiRequest("DELETE", "/api/labels/template");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="w-3 h-3 animate-spin" /> Checking for a P-touch template…
      </div>
    );
  }

  const hasTemplate = template?.present && !template?.broken;

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept=".lbx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
        data-testid="input-lbx-template"
      />

      {hasTemplate ? (
        <>
          <Button
            className="w-full"
            onClick={handleDownload}
            disabled={busy !== null}
            data-testid="btn-open-in-ptouch"
          >
            {busy === "download" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            Open in P-touch
          </Button>

          {(template?.slots?.length ?? 0) > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Which text box holds the address</Label>
              <Select value={String(template?.slot ?? 0)} onValueChange={handleSlot}>
                <SelectTrigger className="h-8" data-testid="select-lbx-slot">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {template?.slots?.map((slot) => (
                    <SelectItem key={slot.index} value={String(slot.index)}>
                      {slot.index + 1}. {slot.preview || "(empty)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="truncate" title={template?.name}>
              Template: {template?.name}
            </span>
            <span className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
                data-testid="btn-replace-template"
              >
                <Upload className="w-3 h-3 mr-1" /> Replace
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-red-600"
                onClick={handleRemove}
                disabled={busy !== null}
                data-testid="btn-remove-template"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </span>
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">
            The file opens in P-touch with the address already in it — then ⌘P. Tick "Always open
            files of this type" on the first download and it opens by itself from then on.
          </p>
        </>
      ) : (
        <>
          {template?.broken && (
            <p className="text-xs text-amber-600 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              The saved template can no longer be read ({template.error}). Upload it again.
            </p>
          )}
          <Button
            className="w-full"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            data-testid="btn-upload-template"
          >
            {busy === "upload" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Upload your P-touch label (.lbx)
          </Button>
          <p className="text-xs text-gray-500 leading-relaxed">
            Save the label you print from today in P-touch Editor and upload it once. Its media,
            margins, font and layout are kept exactly as they are — the CRM only fills in the
            address, so every order comes back as a ready-to-print file.
          </p>
        </>
      )}
    </div>
  );
}
