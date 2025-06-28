import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MetricsCards } from "@/components/dashboard/metrics-cards";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentProducts } from "@/components/dashboard/recent-products";
import { ProductModal } from "@/components/product/product-modal";
import { EditBeforeListingModal } from "@/components/product/edit-before-listing-modal";
import { useLocation } from "wouter";
import type { Product } from "@shared/schema";

interface DashboardProps {
  user: any;
}

export function Dashboard({ user }: DashboardProps) {
  const [, setLocation] = useLocation();
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [editBeforeListingModalOpen, setEditBeforeListingModalOpen] = useState(false);
  const [listingProduct, setListingProduct] = useState<Product | null>(null);
  const [listingMarketplace, setListingMarketplace] = useState<"ebay" | "amazon">("ebay");

  const { data: metrics } = useQuery({
    queryKey: ["/api/dashboard/metrics"],
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const handleAddProduct = () => {
    setSelectedProduct(null);
    setProductModalOpen(true);
  };

  const handleEditProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductModalOpen(true);
  };

  const handleDeleteProduct = (productId: number) => {
    // In a real app, you'd show a confirmation dialog first
    if (confirm("Are you sure you want to delete this product?")) {
      // Delete logic would go here
    }
  };

  const handleViewAll = () => {
    setLocation("/products");
  };

  const handleBulkList = () => {
    setLocation("/marketplaces");
  };

  const handleEditBeforeListingEbay = (product: Product) => {
    setListingProduct(product);
    setListingMarketplace("ebay");
    setEditBeforeListingModalOpen(true);
  };

  const handleEditBeforeListingAmazon = (product: Product) => {
    setListingProduct(product);
    setListingMarketplace("amazon");
    setEditBeforeListingModalOpen(true);
  };

  const handleViewReports = () => {
    // Would navigate to reports page
  };

  const handleManageCategories = () => {
    setLocation("/categories");
  };

  if (!metrics) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar user={user} />
        <div className="ml-64">
          <Header title="Dashboard" subtitle="Loading..." />
          <div className="p-6">
            <div className="animate-pulse space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} />
      <div className="ml-64">
        <Header 
          title="Dashboard" 
          subtitle="Welcome back, monitor your inventory and marketplace performance"
        />
        
        <div className="p-6">
          <MetricsCards metrics={metrics} />
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <QuickActions
                onAddProduct={handleAddProduct}
                onBulkList={handleBulkList}
                onViewReports={handleViewReports}
                onManageCategories={handleManageCategories}
              />
            </div>

            <div className="lg:col-span-2">
              <RecentProducts
                products={products}
                onEditProduct={handleEditProduct}
                onDeleteProduct={handleDeleteProduct}
                onViewAll={handleViewAll}
                onEditBeforeListingEbay={handleEditBeforeListingEbay}
                onEditBeforeListingAmazon={handleEditBeforeListingAmazon}
              />
            </div>
          </div>
        </div>
      </div>

      <ProductModal
        isOpen={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        product={selectedProduct}
      />
    </div>
  );
}
