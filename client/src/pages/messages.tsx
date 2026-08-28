import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Search,
  RefreshCw,
  Send,
  Star,
  StarOff,
  Mail,
  MailOpen,
  ArrowLeft,
  Clock,
  User,
  Package,
  FileText,
  Plus,
  Settings,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader2
} from "lucide-react";
import { format } from "date-fns";
import type { MessageThread, Message, MessageTemplate, AutoMessageRule } from "@shared/schema";

export default function MessagesPage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // The newest message is the one you need; a thread that opens at the top
  // makes you scroll every time.
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  // Customer questions are the work; eBay's own emails are reference material.
  const [inbox, setInbox] = useState<"conversations" | "notifications">("conversations");
  const [replyText, setReplyText] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showAutoRulesDialog, setShowAutoRulesDialog] = useState(false);
  const { toast } = useToast();

  const { data: threadsData, isLoading: threadsLoading, isError: threadsError, error: threadsErrorObj, refetch: refetchThreads } = useQuery<{
    threads: MessageThread[];
    unreadCount: number;
  }>({
    queryKey: ['/api/messages/threads', searchQuery, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (statusFilter !== 'all') {
        if (statusFilter === 'unread') params.append('isRead', 'false');
        else params.append('status', statusFilter);
      }
      // res.ok check: a 401/500 must surface as an error, not render as an
      // empty inbox ("No messages found").
      const res = await fetch(`/api/messages/threads?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      return res.json();
    }
  });

  const { data: messagesData, isLoading: messagesLoading, refetch: refetchMessages } = useQuery<{
    thread: MessageThread;
    messages: Message[];
  }>({
    queryKey: ['/api/messages/threads', selectedThreadId],
    queryFn: async () => {
      if (!selectedThreadId) return { thread: null, messages: [] };
      const res = await fetch(`/api/messages/threads/${selectedThreadId}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!selectedThreadId
  });

  // Jump to the newest message whenever a thread opens or a reply lands.
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    // rAF: the DOM has to paint the new messages before the height is real.
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [selectedThreadId, messagesData?.messages?.length]);


  // Derive the selected thread from LIVE data (detail endpoint first, then the
  // list) instead of a stale snapshot — otherwise star/read toggles in the
  // header never reflect the new state after the mutation refetches.
  const selectedThread: MessageThread | null =
    messagesData?.thread
    ?? (threadsData?.threads ?? []).find((t) => t.id === selectedThreadId)
    ?? null;

  const { data: templatesData } = useQuery<{ templates: MessageTemplate[] }>({
    queryKey: ['/api/messages/templates']
  });

  const { data: rulesData } = useQuery<{ rules: AutoMessageRule[] }>({
    queryKey: ['/api/messages/auto-rules']
  });

  const { data: statusData } = useQuery<{
    ebay: { configured: boolean; message: string };
    unreadCount: number;
    templatesCount: number;
    activeRulesCount: number;
  }>({
    queryKey: ['/api/messages/status']
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/messages/sync/ebay', { daysBack: 30 });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Messages synced",
        description: `Synced ${data.synced} new threads, ${data.updated} updated`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/threads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/status'] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/messages/threads/${selectedThread?.id}/reply`, { body: replyText, templateId: selectedTemplateId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Message sent", description: "Your reply has been sent" });
      setReplyText("");
      setSelectedTemplateId(null);
      refetchMessages();
      refetchThreads();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to send",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const markReadMutation = useMutation({
    mutationFn: async (params: { id: number; isRead: boolean }) => {
      const res = await apiRequest('PATCH', `/api/messages/threads/${params.id}/read`, { isRead: params.isRead });
      return res.json();
    },
    onSuccess: () => {
      // The open thread's header reads from the DETAIL query (selectedThread
      // prefers messagesData.thread), so refetch it too — refetchThreads alone
      // left the read/star icons stale while a thread was open. The status
      // query drives the sidebar unread badge.
      refetchThreads();
      refetchMessages();
      queryClient.invalidateQueries({ queryKey: ['/api/messages/status'] });
    }
  });

  const starMutation = useMutation({
    mutationFn: async (params: { id: number; isStarred: boolean }) => {
      const res = await apiRequest('PATCH', `/api/messages/threads/${params.id}/star`, { isStarred: params.isStarred });
      return res.json();
    },
    onSuccess: () => {
      refetchThreads();
      refetchMessages();
    }
  });

  const handleSelectTemplate = (templateId: number) => {
    const template = templatesData?.templates.find(t => t.id === templateId);
    if (template) {
      setReplyText(template.body);
      setSelectedTemplateId(templateId);
    }
  };

  // Server splits these; fall back to a username check for rows stored before
  // the kind column existed.
  const allThreads = threadsData?.threads || [];
  const conversations = (threadsData as any)?.conversations
    ?? allThreads.filter((t: any) => !/^ebay/i.test(t.buyerUsername ?? ""));
  const notifications = (threadsData as any)?.notifications
    ?? allThreads.filter((t: any) => /^ebay/i.test(t.buyerUsername ?? ""));
  const threads = inbox === "conversations" ? conversations : notifications;
  const threadMessages = messagesData?.messages || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      
      <main className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="p-6 h-screen flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <MessageSquare className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
              {threadsData && threadsData.unreadCount > 0 && (
                <Badge variant="destructive" data-testid="badge-unread-count">
                  {threadsData.unreadCount} unread
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTemplateDialog(true)}
                data-testid="btn-manage-templates"
              >
                <FileText className="w-4 h-4 mr-2" />
                Templates
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAutoRulesDialog(true)}
                data-testid="btn-auto-rules"
              >
                <Zap className="w-4 h-4 mr-2" />
                Auto Messages
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="btn-sync-messages"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                Sync from eBay
              </Button>
            </div>
          </div>

          {statusData && !statusData.ebay.configured && (
            <Card className="mb-4 border-yellow-200 bg-yellow-50">
              <CardContent className="py-3">
                <div className="flex items-center gap-2 text-yellow-800">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{statusData.ebay.message}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex-1 flex gap-4 overflow-hidden">
            <Card className="w-96 flex flex-col">
              <CardHeader className="py-3 px-4 border-b">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Search messages..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9"
                      data-testid="input-search-messages"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-28 h-9" data-testid="select-status-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="unread">Unread</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-0">
                {threadsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : threadsError ? (
                  /* A failed fetch must not render as an empty inbox. */
                  <div className="flex flex-col items-center justify-center py-12">
                    <p className="text-sm font-medium text-red-600">Couldn't load messages.</p>
                    <p className="mt-1 max-w-[90%] break-words text-center font-mono text-xs text-gray-400">
                      {(threadsErrorObj as Error)?.message || "Request failed"}
                    </p>
                  </div>
                ) : threads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
                    <p className="text-sm">No messages found</p>
                    <p className="text-xs mt-1">Sync from eBay to get started</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {threads.map((thread: any) => (
                      <button
                        key={thread.id}
                        onClick={() => setSelectedThreadId(thread.id)}
                        className={`w-full p-3 text-left hover:bg-gray-50 transition-colors ${
                          selectedThread?.id === thread.id ? 'bg-primary/5 border-l-2 border-primary' : ''
                        } ${!thread.isRead ? 'bg-blue-50/50' : ''}`}
                        data-testid={`thread-item-${thread.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {!thread.isRead && (
                                <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                              )}
                              <span className={`text-sm truncate ${!thread.isRead ? 'font-semibold' : 'font-medium'} text-gray-900`}>
                                {thread.buyerUsername}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">
                              {thread.subject || thread.itemTitle || 'No subject'}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-xs text-gray-400">
                              {thread.lastMessageAt ? format(new Date(thread.lastMessageAt), 'MMM d') : ''}
                            </span>
                            <div className="flex items-center gap-1">
                              {thread.isStarred && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                              <Badge variant="outline" className="text-xs px-1 py-0">
                                {thread.messageCount}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex-1 flex min-w-0">
            <Card className="flex-1 flex flex-col min-w-0">
              {selectedThread ? (
                <>
                  <CardHeader className="py-3 px-4 border-b flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedThreadId(null)}
                          className="lg:hidden"
                          data-testid="btn-back-to-list"
                        >
                          <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <div>
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="font-medium text-gray-900">{selectedThread.buyerUsername}</span>
                            <Badge variant="outline" className="text-xs">
                              {selectedThread.marketplace}
                            </Badge>
                          </div>
                          {selectedThread.itemTitle && (
                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                              <Package className="w-3 h-3" />
                              <span className="truncate max-w-md">{selectedThread.itemTitle}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markReadMutation.mutate({
                            id: selectedThread.id,
                            isRead: !selectedThread.isRead
                          })}
                          data-testid="btn-toggle-read"
                        >
                          {selectedThread.isRead ? (
                            <MailOpen className="w-4 h-4" />
                          ) : (
                            <Mail className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => starMutation.mutate({
                            id: selectedThread.id,
                            isStarred: !selectedThread.isStarred
                          })}
                          data-testid="btn-toggle-star"
                        >
                          {selectedThread.isStarred ? (
                            <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                          ) : (
                            <StarOff className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 overflow-y-auto p-4 space-y-4" ref={threadScrollRef}>
                    {messagesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                      </div>
                    ) : threadMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                        <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
                        <p className="text-sm">No messages in this thread</p>
                      </div>
                    ) : (
                      threadMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                          data-testid={`message-item-${msg.id}`}
                        >
                          <div
                            className={`max-w-[70%] rounded-lg p-3 ${
                              msg.direction === 'outbound'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-gray-100 text-gray-900'
                            }`}
                          >
                            {msg.subject && (
                              <p className={`text-xs font-medium mb-1 ${
                                msg.direction === 'outbound' ? 'text-primary-foreground/80' : 'text-gray-500'
                              }`}>
                                {msg.subject}
                              </p>
                            )}
                            {/* `body` is the buyer's actual words, with eBay's
                                notification wrapper stripped. The full original
                                stays one click away rather than being the
                                default — it is a whole email around one line. */}
                            <MessageBody message={msg} />
                            <div className={`flex items-center gap-2 mt-2 text-xs ${
                              msg.direction === 'outbound' ? 'text-primary-foreground/70' : 'text-gray-400'
                            }`}>
                              <Clock className="w-3 h-3" />
                              <span>{(msg.sentAt ?? msg.createdAt) ? format(new Date((msg.sentAt ?? msg.createdAt) as any), 'MMM d, h:mm a') : ''}</span>
                              {msg.status === 'sent' && <CheckCircle className="w-3 h-3" />}
                              {msg.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-400" />}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>

                  <div className="border-t p-4 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Select
                        value={selectedTemplateId?.toString() || ""}
                        onValueChange={(val) => val && handleSelectTemplate(parseInt(val))}
                      >
                        <SelectTrigger className="w-48 h-8 text-xs" data-testid="select-template">
                          <SelectValue placeholder="Use template..." />
                        </SelectTrigger>
                        <SelectContent>
                          {templatesData?.templates.map((template) => (
                            <SelectItem key={template.id} value={template.id.toString()}>
                              {template.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Type your reply..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        className="flex-1 min-h-[80px] resize-none"
                        data-testid="textarea-reply"
                      />
                      <Button
                        onClick={() => replyMutation.mutate()}
                        disabled={!replyText.trim() || replyMutation.isPending}
                        className="self-end"
                        data-testid="btn-send-reply"
                      >
                        {replyMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                  <MessageSquare className="w-16 h-16 mb-4 opacity-30" />
                  <h3 className="text-lg font-medium text-gray-700">Select a conversation</h3>
                  <p className="text-sm mt-1">Choose a message thread from the list to view and reply</p>
                </div>
              )}
            </Card>
            {/* Buyer and order context beside the conversation, so replying
                does not mean opening eBay in another tab. */}
            {selectedThread && (
              <div className="hidden xl:flex">
                <BuyerContextPanel threadId={selectedThread.id} />
              </div>
            )}
            </div>
          </div>
        </div>
      </main>

      <TemplatesDialog
        open={showTemplateDialog}
        onOpenChange={setShowTemplateDialog}
        templates={templatesData?.templates || []}
      />

      <AutoRulesDialog
        open={showAutoRulesDialog}
        onOpenChange={setShowAutoRulesDialog}
        rules={rulesData?.rules || []}
        templates={templatesData?.templates || []}
      />
    </div>
  );
}

function TemplatesDialog({
  open,
  onOpenChange,
  templates
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: MessageTemplate[];
}) {
  const [editingTemplate, setEditingTemplate] = useState<Partial<MessageTemplate> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/messages/templates', data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Template created" });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/templates'] });
      setShowForm(false);
      setEditingTemplate(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('PATCH', `/api/messages/templates/${editingTemplate?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Template updated" });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/templates'] });
      setShowForm(false);
      setEditingTemplate(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('DELETE', `/api/messages/templates/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Template deleted" });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/templates'] });
    }
  });

  const handleSubmit = () => {
    if (!editingTemplate?.name || !editingTemplate?.body) return;
    
    const data = {
      name: editingTemplate.name,
      body: editingTemplate.body,
      subject: editingTemplate.subject,
      category: editingTemplate.category || 'general',
      description: editingTemplate.description
    };

    if (editingTemplate.id) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Message Templates</DialogTitle>
        </DialogHeader>

        {showForm ? (
          <div className="space-y-4 flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={editingTemplate?.name || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                  placeholder="Template name"
                  data-testid="input-template-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Category</label>
                <Select
                  value={editingTemplate?.category || 'general'}
                  onValueChange={(val) => setEditingTemplate({ ...editingTemplate, category: val })}
                >
                  <SelectTrigger data-testid="select-template-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="thank_you">Thank You</SelectItem>
                    <SelectItem value="shipping">Shipping</SelectItem>
                    <SelectItem value="follow_up">Follow Up</SelectItem>
                    <SelectItem value="return">Return</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Subject (optional)</label>
              <Input
                value={editingTemplate?.subject || ''}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                placeholder="Email subject"
                data-testid="input-template-subject"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Body</label>
              <Textarea
                value={editingTemplate?.body || ''}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                placeholder="Message content. Use {{buyer_name}}, {{order_id}}, {{item_title}}, {{tracking_number}} as placeholders"
                className="min-h-[150px]"
                data-testid="textarea-template-body"
              />
            </div>
            <p className="text-xs text-gray-500">
              Available placeholders: {'{{buyer_name}}'}, {'{{order_id}}'}, {'{{item_title}}'}, {'{{tracking_number}}'}, {'{{shop_name}}'}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowForm(false); setEditingTemplate(null); }}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                {editingTemplate?.id ? 'Update' : 'Create'} Template
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Button
              onClick={() => { setShowForm(true); setEditingTemplate({}); }}
              className="mb-4"
              data-testid="btn-add-template"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Template
            </Button>

            {templates.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>No templates yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="p-3 border rounded-lg hover:bg-gray-50"
                    data-testid={`template-item-${template.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{template.name}</span>
                          <Badge variant="outline" className="text-xs">{template.category}</Badge>
                          {template.isDefault && <Badge className="text-xs">Default</Badge>}
                        </div>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{template.body}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                          <span>Used {template.usageCount} times</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditingTemplate(template); setShowForm(true); }}
                          data-testid={`btn-edit-template-${template.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(template.id)}
                          className="text-red-600 hover:text-red-700"
                          data-testid={`btn-delete-template-${template.id}`}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AutoRulesDialog({
  open,
  onOpenChange,
  rules,
  templates
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: AutoMessageRule[];
  templates: MessageTemplate[];
}) {
  const [editingRule, setEditingRule] = useState<Partial<AutoMessageRule> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/messages/auto-rules', data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule created" });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/auto-rules'] });
      setShowForm(false);
      setEditingRule(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('PATCH', `/api/messages/auto-rules/${editingRule?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule updated" });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/auto-rules'] });
      setShowForm(false);
      setEditingRule(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('DELETE', `/api/messages/auto-rules/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule deleted" });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/auto-rules'] });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: async (params: { id: number; isActive: boolean }) => {
      const res = await apiRequest('PATCH', `/api/messages/auto-rules/${params.id}`, { isActive: params.isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/messages/auto-rules'] });
    }
  });

  const handleSubmit = () => {
    if (!editingRule?.name || !editingRule?.triggerType || !editingRule?.templateId) return;

    const data = {
      name: editingRule.name,
      description: editingRule.description,
      triggerType: editingRule.triggerType,
      triggerDelay: editingRule.triggerDelay || 0,
      triggerDelayUnit: editingRule.triggerDelayUnit || 'minutes',
      templateId: editingRule.templateId,
      isActive: editingRule.isActive ?? true
    };

    if (editingRule.id) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const triggerTypes = [
    { value: 'order_placed', label: 'Order Placed' },
    { value: 'order_packed', label: 'Order Packed' },
    { value: 'order_shipped', label: 'Order Shipped' },
    { value: 'order_delivered', label: 'Order Delivered' },
    { value: 'days_after_delivery', label: 'Days After Delivery' }
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Auto-Message Rules</DialogTitle>
        </DialogHeader>

        {showForm ? (
          <div className="space-y-4 flex-1 overflow-y-auto">
            <div>
              <label className="text-sm font-medium">Rule Name</label>
              <Input
                value={editingRule?.name || ''}
                onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                placeholder="e.g., Thank you after order"
                data-testid="input-rule-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                value={editingRule?.description || ''}
                onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                placeholder="Optional description"
                data-testid="input-rule-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Trigger</label>
                <Select
                  value={editingRule?.triggerType || ''}
                  onValueChange={(val) => setEditingRule({ ...editingRule, triggerType: val })}
                >
                  <SelectTrigger data-testid="select-rule-trigger">
                    <SelectValue placeholder="When to send..." />
                  </SelectTrigger>
                  <SelectContent>
                    {triggerTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Template</label>
                <Select
                  value={editingRule?.templateId?.toString() || ''}
                  onValueChange={(val) => setEditingRule({ ...editingRule, templateId: parseInt(val) })}
                >
                  <SelectTrigger data-testid="select-rule-template">
                    <SelectValue placeholder="Select template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Delay Amount</label>
                <Input
                  type="number"
                  min={0}
                  value={editingRule?.triggerDelay || 0}
                  onChange={(e) => setEditingRule({ ...editingRule, triggerDelay: parseInt(e.target.value) })}
                  data-testid="input-rule-delay"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Delay Unit</label>
                <Select
                  value={editingRule?.triggerDelayUnit || 'minutes'}
                  onValueChange={(val) => setEditingRule({ ...editingRule, triggerDelayUnit: val })}
                >
                  <SelectTrigger data-testid="select-rule-delay-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowForm(false); setEditingRule(null); }}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                {editingRule?.id ? 'Update' : 'Create'} Rule
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Button
              onClick={() => { setShowForm(true); setEditingRule({ isActive: true }); }}
              className="mb-4"
              data-testid="btn-add-rule"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Rule
            </Button>

            {rules.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Zap className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>No auto-message rules yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map((rule) => {
                  const template = templates.find(t => t.id === rule.templateId);
                  return (
                    <div
                      key={rule.id}
                      className={`p-3 border rounded-lg ${rule.isActive ? 'hover:bg-gray-50' : 'bg-gray-100 opacity-60'}`}
                      data-testid={`rule-item-${rule.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{rule.name}</span>
                            <Badge variant={rule.isActive ? 'default' : 'secondary'} className="text-xs">
                              {rule.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-500 mt-1">
                            Trigger: {triggerTypes.find(t => t.value === rule.triggerType)?.label}
                            {rule.triggerDelay ? ` (after ${rule.triggerDelay} ${rule.triggerDelayUnit})` : ''}
                          </p>
                          <p className="text-sm text-gray-500">
                            Template: {template?.name || 'Unknown'}
                          </p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                            <span>Sent {rule.sentCount} times</span>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })}
                            data-testid={`btn-toggle-rule-${rule.id}`}
                          >
                            {rule.isActive ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditingRule(rule); setShowForm(true); }}
                            data-testid={`btn-edit-rule-${rule.id}`}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteMutation.mutate(rule.id)}
                            className="text-red-600 hover:text-red-700"
                            data-testid={`btn-delete-rule-${rule.id}`}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


/**
 * Who this buyer is and what they bought.
 *
 * Answering a message means knowing what was ordered, whether it shipped and
 * what it was worth — otherwise every reply means opening eBay in another tab.
 */
function BuyerContextPanel({ threadId }: { threadId: number }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/messages/threads', threadId, 'context'],
    queryFn: async () => {
      const r = await fetch(`/api/messages/threads/${threadId}/context`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  if (isLoading) return <div className="p-4 text-sm text-gray-400">Loading buyer…</div>;
  if (!data?.success) return null;

  const b = data.buyer;
  const money = (n: number, c = 'EUR') => `${c === 'EUR' ? '€' : ''}${Number(n).toFixed(2)}`;

  return (
    <div className="w-80 border-l bg-gray-50 overflow-y-auto flex-shrink-0">
      <div className="p-4 border-b bg-white">
        <p className="font-medium">{b.name || b.username}</p>
        <p className="text-xs text-gray-500">{b.username}</p>
        {b.email && <p className="text-xs text-gray-500 break-all">{b.email}</p>}
        {(b.city || b.country) && (
          <p className="text-xs text-gray-500 mt-1">{[b.city, b.country].filter(Boolean).join(', ')}</p>
        )}
        {b.phone && <p className="text-xs text-gray-500">Tel: {b.phone}</p>}
        <div className="flex gap-4 mt-3 text-xs">
          <div>
            <div className="text-gray-400">Orders</div>
            <div className="font-semibold text-sm">{b.orderCount}</div>
          </div>
          <div>
            <div className="text-gray-400">Total spent</div>
            <div className="font-semibold text-sm">{money(b.totalSpent, b.currency)}</div>
          </div>
        </div>
      </div>

      {data.item && (
        <div className="p-3 border-b bg-white">
          <p className="text-xs text-gray-400 mb-1">Message is about</p>
          <p className="text-xs">{data.item.title || data.item.itemId}</p>
          <a
            className="text-xs text-blue-600 hover:underline"
            href={`https://www.ebay.de/itm/${data.item.itemId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View listing on eBay
          </a>
        </div>
      )}

      <div className="p-3 space-y-3">
        <p className="text-xs font-medium text-gray-600">Orders ({data.orders.length})</p>
        {data.orders.length === 0 && (
          // Most questions arrive BEFORE the sale; say so rather than looking broken.
          <p className="text-xs text-gray-400">No orders from this buyer yet — likely a pre-sale question.</p>
        )}
        {data.orders.map((o: any) => (
          <div key={o.id} className="border rounded bg-white p-2 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono">#{o.marketplaceOrderId}</span>
              <Badge variant={o.status === 'shipped' || o.status === 'delivered' ? 'default' : 'secondary'}>
                {o.status}
              </Badge>
            </div>
            <div className="text-gray-500">
              {o.orderDate ? format(new Date(o.orderDate), 'd MMM yyyy') : ''} · {money(o.total, o.currency)}
            </div>
            {o.items.map((i: any, n: number) => (
              <div key={n} className="flex items-center gap-2 pt-1">
                {i.imageUrl && (
                  <img src={i.imageUrl} alt="" className="w-8 h-8 object-contain bg-white border rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{i.quantity}× {i.title || i.sku}</div>
                  <div className="text-gray-400 font-mono">{i.sku}</div>
                </div>
              </div>
            ))}
            {o.trackingNumber ? (
              <div className="text-gray-600 pt-1">
                Tracking: <span className="font-mono">{o.trackingNumber}</span>
                {o.carrier ? ` (${o.carrier})` : ''}
              </div>
            ) : (
              <div className="text-amber-600 pt-1">Not shipped yet</div>
            )}
            {o.shipTo && <div className="text-gray-400">{o.shipTo}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}


/**
 * One message: the buyer's words by default, the full eBay notification on
 * demand.
 *
 * eBay sends an email ABOUT the message — header, preview copy, buttons,
 * greeting, signature, item block, footer — around what is often a single
 * sentence. Showing all of it buries the question, so the extracted text leads
 * and the original is a click away, never discarded.
 */
function MessageBody({ message }: { message: any }) {
  const [showOriginal, setShowOriginal] = useState(false);
  // Only worth offering when the original genuinely holds more than the text.
  const hasMore =
    !!message.bodyHtml &&
    message.bodyHtml.replace(/<[^>]+>/g, "").trim().length > (message.body?.length ?? 0) + 40;

  return (
    <div>
      {showOriginal && message.bodyHtml ? (
        <div className="text-sm message-html" dangerouslySetInnerHTML={{ __html: message.bodyHtml }} />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{message.body}</p>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={() => setShowOriginal((v) => !v)}
          className={`mt-1.5 text-[11px] underline opacity-70 hover:opacity-100 ${
            message.direction === "outbound" ? "text-primary-foreground" : "text-gray-500"
          }`}
          data-testid="btn-toggle-original"
        >
          {showOriginal ? "Show message only" : "Show full eBay notification"}
        </button>
      )}
    </div>
  );
}
