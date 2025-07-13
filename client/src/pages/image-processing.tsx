
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, XCircle, Loader2, Upload, Download, Trash2, Image as ImageIcon } from 'lucide-react';

interface ProcessingResult {
  success: boolean;
  processedImageUrl?: string;
  originalImageUrl: string;
  error?: string;
  processingTime?: number;
}

interface BatchResult {
  total: number;
  successful: number;
  failed: number;
  results: ProcessingResult[];
}

export default function ImageProcessingPage() {
  const [singleImageUrl, setSingleImageUrl] = useState('');
  const [batchImageUrls, setBatchImageUrls] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingResults, setProcessingResults] = useState<ProcessingResult[]>([]);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [useAdvanced, setUseAdvanced] = useState(false);

  const processSingleImage = async () => {
    if (!singleImageUrl.trim()) return;

    setIsProcessing(true);
    try {
      const response = await fetch('/api/images/process-watermark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          imageUrl: singleImageUrl.trim(),
          advanced: useAdvanced 
        })
      });

      const result = await response.json();
      setProcessingResults([result]);
    } catch (error) {
      console.error('Failed to process image:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const processBatchImages = async () => {
    const urls = batchImageUrls
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    if (urls.length === 0) return;

    setIsProcessing(true);
    try {
      const response = await fetch('/api/images/process-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls: urls })
      });

      const result = await response.json();
      setBatchResult(result);
      setProcessingResults(result.results);
    } catch (error) {
      console.error('Failed to process batch:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const cleanupOldImages = async () => {
    try {
      const response = await fetch('/api/images/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgeHours: 24 })
      });

      const result = await response.json();
      alert('Cleanup completed successfully');
    } catch (error) {
      console.error('Cleanup failed:', error);
      alert('Cleanup failed');
    }
  };

  const downloadProcessedImage = (url: string, originalUrl: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `processed_${Date.now()}.jpg`;
    link.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Image Processing</h1>
          <p className="text-muted-foreground">
            Remove TME watermarks from product images before eBay listing
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={cleanupOldImages} variant="outline" size="sm">
            <Trash2 className="h-4 w-4 mr-2" />
            Cleanup Old Images
          </Button>
        </div>
      </div>

      <Tabs defaultValue="single" className="space-y-4">
        <TabsList>
          <TabsTrigger value="single">Single Image</TabsTrigger>
          <TabsTrigger value="batch">Batch Processing</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                Process Single Image
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">TME Image URL</label>
                <Input
                  value={singleImageUrl}
                  onChange={(e) => setSingleImageUrl(e.target.value)}
                  placeholder="https://www.tme.eu/Document/..."
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useAdvanced}
                  onChange={(e) => setUseAdvanced(e.target.checked)}
                  className="rounded"
                />
                <label className="text-sm">Use advanced watermark removal</label>
              </div>

              <Button 
                onClick={processSingleImage} 
                disabled={isProcessing || !singleImageUrl.trim()}
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Remove Watermark
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batch" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                Batch Processing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">TME Image URLs (one per line, max 20)</label>
                <Textarea
                  value={batchImageUrls}
                  onChange={(e) => setBatchImageUrls(e.target.value)}
                  placeholder="https://www.tme.eu/Document/image1.jpg&#10;https://www.tme.eu/Document/image2.jpg&#10;..."
                  rows={8}
                />
              </div>

              <Button 
                onClick={processBatchImages} 
                disabled={isProcessing || !batchImageUrls.trim()}
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing Batch...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Process Batch
                  </>
                )}
              </Button>

              {batchResult && (
                <Alert>
                  <AlertDescription>
                    Batch completed: {batchResult.successful}/{batchResult.total} images processed successfully
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Processing Results</CardTitle>
            </CardHeader>
            <CardContent>
              {processingResults.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No processing results yet. Process some images to see results here.
                </p>
              ) : (
                <div className="space-y-4">
                  {processingResults.map((result, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {result.success ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                          <Badge variant={result.success ? "default" : "destructive"}>
                            {result.success ? "Success" : "Failed"}
                          </Badge>
                          {result.processingTime && (
                            <Badge variant="outline">
                              {result.processingTime}ms
                            </Badge>
                          )}
                        </div>
                        {result.success && result.processedImageUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadProcessedImage(result.processedImageUrl!, result.originalImageUrl)}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </Button>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div>
                          <p className="text-sm font-medium">Original URL:</p>
                          <p className="text-xs text-muted-foreground break-all">
                            {result.originalImageUrl}
                          </p>
                        </div>

                        {result.success && result.processedImageUrl && (
                          <div>
                            <p className="text-sm font-medium">Processed URL:</p>
                            <p className="text-xs text-muted-foreground break-all">
                              {result.processedImageUrl}
                            </p>
                          </div>
                        )}

                        {result.error && (
                          <div>
                            <p className="text-sm font-medium text-red-600">Error:</p>
                            <p className="text-xs text-red-500">{result.error}</p>
                          </div>
                        )}
                      </div>

                      {result.success && result.processedImageUrl && (
                        <div className="mt-4 grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm font-medium mb-2">Original</p>
                            <img 
                              src={result.originalImageUrl} 
                              alt="Original"
                              className="w-full h-32 object-cover rounded border"
                            />
                          </div>
                          <div>
                            <p className="text-sm font-medium mb-2">Processed</p>
                            <img 
                              src={result.processedImageUrl} 
                              alt="Processed"
                              className="w-full h-32 object-cover rounded border"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
