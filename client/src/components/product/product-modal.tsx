import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProductSchema, type Product, type Category } from "@shared/schema";
import { z } from "zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const productFormSchema = insertProductSchema.extend({
  supplierPrice: z.string().min(1, "Supplier price is required"),
  salePrice: z.string().min(1, "Sale price is required"),
  stock: z.string().min(1, "Stock is required"),
  weight: z.string().optional(),
});

type ProductFormData = z.infer<typeof productFormSchema>;

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: Product | null;
}

export function ProductModal({ isOpen, onClose, product }: ProductModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [calculatedMargin, setCalculatedMargin] = useState<string>("0");
  const [marginTierInfo, setMarginTierInfo] = useState<{ tier: string; percentage: string } | null>(null);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
    enabled: isOpen,
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: "",
      sku: "",
      ean: "",
      category: "",
      description: "",
      supplierPrice: "",
      salePrice: "",
      stock: "0",
      weight: "",
      status: "active",
      listedOnEbay: false,
      listedOnAmazon: false,
      excludeFromListing: false,
    },
  });

  // Update form when product changes
  useEffect(() => {
    if (product) {
      form.reset({
        name: product.name,
        sku: product.sku,
        ean: product.ean || "",
        category: product.category,
        description: product.description || "",
        supplierPrice: product.supplierPrice,
        salePrice: product.salePrice,
        stock: product.stock.toString(),
        weight: product.weight?.toString() || "",
        status: product.status,
        listedOnEbay: product.listedOnEbay,
        listedOnAmazon: product.listedOnAmazon,
        excludeFromListing: product.excludeFromListing,
      });

      // Set dynamic pricing information if available
      if (product.marginTier && product.marginPercentage) {
        setMarginTierInfo({
          tier: product.marginTier,
          percentage: product.marginPercentage
        });
      } else {
        setMarginTierInfo(null);
      }
    } else {
      form.reset({
        name: "",
        sku: "",
        ean: "",
        category: "",
        description: "",
        supplierPrice: "",
        salePrice: "",
        stock: "0",
        weight: "",
        status: "active",
        listedOnEbay: false,
        listedOnAmazon: false,
        excludeFromListing: false,
      });
      setMarginTierInfo(null);
    }
  }, [product, form]);

  // Calculate margin when prices change
  const supplierPrice = form.watch("supplierPrice");
  const salePrice = form.watch("salePrice");

  useEffect(() => {
    const supplier = parseFloat(supplierPrice) || 0;
    const sale = parseFloat(salePrice) || 0;
    if (supplier > 0 && sale > 0) {
      const margin = ((sale - supplier) / sale * 100).toFixed(1);
      setCalculatedMargin(margin);
    } else {
      setCalculatedMargin("0");
    }
  }, [supplierPrice, salePrice]);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/products", data),
    onSuccess: () => {
      toast({
        title: "Product Created",
        description: "The product has been created successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create product.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/products/${product?.id}`, data),
    onSuccess: () => {
      toast({
        title: "Product Updated",
        description: "The product has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update product.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ProductFormData) => {
    const payload = {
      ...data,
      supplierPrice: data.supplierPrice,
      salePrice: data.salePrice,
      stock: parseInt(data.stock),
      weight: data.weight ? parseFloat(data.weight) : undefined,
    };

    if (product) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {product ? "Edit Product" : "Add New Product"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Basic Information</h3>
              
              <div>
                <Label htmlFor="name">Product Name</Label>
                <Input 
                  id="name"
                  {...form.register("name")}
                  className="mt-1"
                />
                {form.formState.errors.name && (
                  <p className="text-red-500 text-sm mt-1">{form.formState.errors.name.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="sku">SKU</Label>
                <Input 
                  id="sku"
                  {...form.register("sku")}
                  className="mt-1"
                />
                {form.formState.errors.sku && (
                  <p className="text-red-500 text-sm mt-1">{form.formState.errors.sku.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="ean">EAN/UPC</Label>
                <Input 
                  id="ean"
                  {...form.register("ean")}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="category">Category</Label>
                <Select 
                  value={form.watch("category")} 
                  onValueChange={(value) => form.setValue("category", value)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.name}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.category && (
                  <p className="text-red-500 text-sm mt-1">{form.formState.errors.category.message}</p>
                )}
              </div>
            </div>

            {/* Pricing & Inventory */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Pricing & Inventory</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="supplierPrice">Supplier Price</Label>
                  <Input 
                    id="supplierPrice"
                    type="number"
                    step="0.01"
                    {...form.register("supplierPrice")}
                    className="mt-1"
                  />
                  {form.formState.errors.supplierPrice && (
                    <p className="text-red-500 text-sm mt-1">{form.formState.errors.supplierPrice.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="salePrice">Sale Price</Label>
                  <Input 
                    id="salePrice"
                    type="number"
                    step="0.01"
                    {...form.register("salePrice")}
                    className="mt-1"
                  />
                  {form.formState.errors.salePrice && (
                    <p className="text-red-500 text-sm mt-1">{form.formState.errors.salePrice.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="stock">Stock Quantity</Label>
                  <Input 
                    id="stock"
                    type="number"
                    {...form.register("stock")}
                    className="mt-1"
                  />
                  {form.formState.errors.stock && (
                    <p className="text-red-500 text-sm mt-1">{form.formState.errors.stock.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="weight">Weight (g)</Label>
                  <Input 
                    id="weight"
                    type="number"
                    step="0.01"
                    min="0"
                    {...form.register("weight")}
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="margin">Margin (%)</Label>
                {marginTierInfo ? (
                  <div className="space-y-2">
                    <Input 
                      id="margin"
                      value={`${marginTierInfo.percentage}% (${marginTierInfo.tier})`}
                      readOnly
                      className="mt-1 bg-blue-50 border-blue-200 text-blue-800"
                    />
                    <p className="text-xs text-blue-600 mt-1">
                      ✓ Dynamic pricing tier applied - {marginTierInfo.tier} margin
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input 
                      id="margin"
                      value={calculatedMargin}
                      readOnly
                      className="mt-1 bg-gray-50"
                    />
                    <p className="text-xs text-gray-500 mt-1">Manual calculation - consider applying dynamic pricing</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Marketplace Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Marketplace Settings</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-green-100 rounded mr-3 flex items-center justify-center">
                    <span className="text-xs font-bold text-green-600">eB</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">List on eBay</p>
                    <p className="text-xs text-gray-500">Auction & Buy It Now</p>
                  </div>
                </div>
                <Checkbox 
                  checked={form.watch("listedOnEbay")}
                  onCheckedChange={(checked) => form.setValue("listedOnEbay", !!checked)}
                />
              </div>
              
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-orange-100 rounded mr-3 flex items-center justify-center">
                    <span className="text-xs font-bold text-orange-600">Am</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">List on Amazon</p>
                    <p className="text-xs text-gray-500">FBA & FBM</p>
                  </div>
                </div>
                <Checkbox 
                  checked={form.watch("listedOnAmazon")}
                  onCheckedChange={(checked) => form.setValue("listedOnAmazon", !!checked)}
                />
              </div>
            </div>
          </div>

          {/* Product Description */}
          <div>
            <Label htmlFor="description">Product Description</Label>
            <Textarea 
              id="description"
              {...form.register("description")}
              rows={4}
              className="mt-1"
              placeholder="Enter product description..."
            />
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end space-x-4 pt-6 border-t border-gray-200">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : product ? "Save Changes" : "Create Product"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
