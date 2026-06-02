import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Product } from "@shared/schema";

const editListingSchema = z.object({
  name: z.string().min(1, "Title is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  salePrice: z.string().min(1, "Price is required"),
  stock: z.string().min(1, "Stock is required"),
  categoryId: z.string().default("58277"),
});

interface EditBeforeListingModalProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketplace: "ebay" | "amazon";
}

export function EditBeforeListingModal({
  product,
  open,
  onOpenChange,
  marketplace,
}: EditBeforeListingModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isListing, setIsListing] = useState(false);

  const form = useForm<z.infer<typeof editListingSchema>>({
    resolver: zodResolver(editListingSchema),
    defaultValues: {
      name: product?.name || "",
      description: product?.description || "",
      salePrice: product?.salePrice?.toString() || "",
      stock: product?.stock?.toString() || "",
      categoryId: "58277",
    },
  });

  // Reset form when product changes
  useEffect(() => {
    if (product) {
      form.reset({
        name: product.name,
        description: product.description || "",
        salePrice: product.salePrice?.toString() || "",
        stock: product.stock?.toString() || "",
        categoryId: "58277",
      });
    }
  }, [product, form]);

  const listProductMutation = useMutation({
    mutationFn: async (data: z.infer<typeof editListingSchema>) => {
      if (!product) throw new Error("No product selected");
      
      // First update the product with edited data
      await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          salePrice: parseFloat(data.salePrice),
          stock: parseInt(data.stock),
        }),
      });

      // Then list to marketplace
      const endpoint = marketplace === "ebay" ? "/api/ebay/list-uk" : "/api/amazon/list";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          title: data.name,
          description: data.description,
          startPrice: parseFloat(data.salePrice),
          quantity: parseInt(data.stock),
          categoryId: data.categoryId,
        }),
      });

      return response.json();
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      onOpenChange(false);
      
      if (response.success) {
        toast({
          title: "Success!",
          description: `Product listed successfully on ${marketplace.toUpperCase()}${response.itemId ? ` (ID: ${response.itemId})` : ""}`,
        });
      } else {
        toast({
          title: "Listing Warning",
          description: response.message || `Product listing had issues: ${response.error}`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to list product on ${marketplace.toUpperCase()}`,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsListing(false);
    },
  });

  const onSubmit = (data: z.infer<typeof editListingSchema>) => {
    setIsListing(true);
    listProductMutation.mutate(data);
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Edit & List to {marketplace.toUpperCase()}: {product.name}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Product title for listing" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="Detailed product description for marketplace listing"
                      rows={4}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="salePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (EUR)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" placeholder="0.00" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="stock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" placeholder="1" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>eBay Category ID</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder="58277" 
                      disabled={marketplace === "amazon"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isListing}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isListing}>
                {isListing ? "Listing..." : `List to ${marketplace.toUpperCase()}`}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}