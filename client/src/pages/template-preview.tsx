import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Eye, Copy, FileText, Globe, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ListingTemplate {
  title: string;
  description: string;
  htmlDescription: string;
  subtitle?: string;
  keywords: string[];
}

export function TemplatePreview({ user }: { user: any }) {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Fetch products for selection
  const { data: products = [] } = useQuery<Array<{ id: number; name: string; sku: string }>>({
    queryKey: ["/api/products"],
  });

  // Fetch template for selected product
  const { data: templateData, isLoading, refetch } = useQuery<{
    success: boolean;
    template: ListingTemplate;
    product: { id: number; name: string; sku: string };
  }>({
    queryKey: ["/api/ebay/template", selectedProductId],
    enabled: !!selectedProductId,
  });

  const template = templateData?.template;
  const product = templateData?.product;

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to Clipboard",
      description: `${type} copied successfully`,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Header 
          title="eBay Listing Templates" 
          subtitle="Preview professional listing templates with TME product data"
        />
        
        <div className="p-6 space-y-6">
          {/* Product Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileText className="h-5 w-5" />
                <span>Template Generator</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-4">
                <div className="flex-1">
                  <label className="text-sm font-medium">Select Product</label>
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Choose a product to preview template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id.toString()}>
                          {product.name} ({product.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <Button 
                  onClick={() => refetch()}
                  disabled={!selectedProductId || isLoading}
                  variant="outline"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Template Preview */}
          {template && product && (
            <div className="space-y-6">
              {/* Title and Subtitle Preview */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Listing Title & Subtitle</span>
                    <Badge variant="secondary">{template.title.length}/80 chars</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Title</label>
                    <div className="mt-1 p-3 bg-blue-50 rounded-lg border">
                      <div className="font-semibold text-blue-900">{template.title}</div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => copyToClipboard(template.title, "Title")}
                      className="mt-2"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy Title
                    </Button>
                  </div>

                  {template.subtitle && (
                    <div>
                      <label className="text-sm font-medium text-gray-600">Subtitle</label>
                      <div className="mt-1 p-3 bg-green-50 rounded-lg border">
                        <div className="text-green-900">{template.subtitle}</div>
                      </div>
                      <div className="flex justify-between items-center mt-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => copyToClipboard(template.subtitle, "Subtitle")}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy Subtitle
                        </Button>
                        <Badge variant="outline">{template.subtitle.length}/55 chars</Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Description Preview */}
              <Card>
                <CardHeader>
                  <CardTitle>Description Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="formatted" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="formatted">Formatted View</TabsTrigger>
                      <TabsTrigger value="plain">Plain Text</TabsTrigger>
                      <TabsTrigger value="html">HTML Source</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="formatted" className="mt-4">
                      <div className="border rounded-lg p-6 bg-white max-h-96 overflow-y-auto">
                        <div className="prose prose-sm max-w-none">
                          {template.description.split('\n').map((line, index) => {
                            if (line.startsWith('🔧 PROFESSIONAL')) {
                              return <h2 key={index} className="text-xl font-bold text-blue-600 mb-2">{line}</h2>;
                            }
                            if (line.startsWith('📋 ') || line.startsWith('🏭 ') || line.startsWith('📦 ') || line.startsWith('💡 ')) {
                              return <h3 key={index} className="text-lg font-semibold text-gray-800 mt-4 mb-2">{line}</h3>;
                            }
                            if (line.startsWith('✅ ')) {
                              return <div key={index} className="text-green-600 mb-1">{line}</div>;
                            }
                            if (line.startsWith('• ')) {
                              return <li key={index} className="ml-4 mb-1">{line.substring(2)}</li>;
                            }
                            if (line.includes('🚚 FAST UK SHIPPING')) {
                              return <div key={index} className="text-center font-bold text-blue-600 bg-blue-50 p-3 rounded-lg mt-4">{line}</div>;
                            }
                            if (line.trim()) {
                              return <p key={index} className="mb-2">{line}</p>;
                            }
                            return <br key={index} />;
                          })}
                        </div>
                      </div>
                      <Button 
                        onClick={() => copyToClipboard(template.description, "Description")}
                        className="mt-4"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Formatted Description
                      </Button>
                    </TabsContent>
                    
                    <TabsContent value="plain" className="mt-4">
                      <div className="border rounded-lg p-4 bg-gray-50 max-h-96 overflow-y-auto">
                        <pre className="whitespace-pre-wrap text-sm font-mono">{template.description}</pre>
                      </div>
                      <Button 
                        onClick={() => copyToClipboard(template.description, "Plain Description")}
                        className="mt-4"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Plain Text
                      </Button>
                    </TabsContent>
                    
                    <TabsContent value="html" className="mt-4">
                      <div className="border rounded-lg p-4 bg-gray-50 max-h-96 overflow-y-auto">
                        <pre className="whitespace-pre-wrap text-sm font-mono">{template.htmlDescription}</pre>
                      </div>
                      <Button 
                        onClick={() => copyToClipboard(template.htmlDescription, "HTML Description")}
                        className="mt-4"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy HTML
                      </Button>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {/* Keywords */}
              <Card>
                <CardHeader>
                  <CardTitle>SEO Keywords</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {template.keywords.map((keyword, index) => (
                      <Badge key={index} variant="outline">{keyword}</Badge>
                    ))}
                  </div>
                  <Button 
                    onClick={() => copyToClipboard(template.keywords.join(', '), "Keywords")}
                    variant="outline"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy All Keywords
                  </Button>
                </CardContent>
              </Card>

              {/* Template Features */}
              <Card className="border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="text-green-800">Professional Template Features</CardTitle>
                </CardHeader>
                <CardContent className="text-green-700">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <strong>SEO Optimized:</strong> 80-character title limit with keywords
                    </div>
                    <div>
                      <strong>Technical Specs:</strong> Automatic specification extraction
                    </div>
                    <div>
                      <strong>Professional Format:</strong> Structured sections with emojis
                    </div>
                    <div>
                      <strong>Category Matching:</strong> Targeted applications and keywords
                    </div>
                    <div>
                      <strong>Trust Signals:</strong> Quality guarantees and support promises
                    </div>
                    <div>
                      <strong>Mobile Friendly:</strong> Readable on all devices
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Instructions */}
          {!selectedProductId && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-6">
                <div className="text-center text-blue-800">
                  <Globe className="h-12 w-12 mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">Professional eBay Listing Templates</h3>
                  <p className="text-sm">
                    Select a product above to generate a professional eBay listing template with:
                  </p>
                  <ul className="text-sm mt-2 space-y-1">
                    <li>• SEO-optimized titles and descriptions</li>
                    <li>• Technical specifications extraction</li>
                    <li>• Professional formatting with trust signals</li>
                    <li>• Category-specific applications and keywords</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {isLoading && (
            <Card>
              <CardContent className="p-6 text-center">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-500" />
                <p>Generating professional listing template...</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}