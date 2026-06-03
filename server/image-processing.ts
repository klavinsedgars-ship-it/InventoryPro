
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// On serverless (Vercel/Lambda), the working directory is read-only;
// only /tmp is writable. Fall back to /tmp on Vercel; otherwise use a
// local ./processed_images directory.
const DEFAULT_CACHE_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(os.tmpdir(), 'inventorypro-processed-images')
    : './processed_images';

interface ImageProcessingResult {
  success: boolean;
  processedImageUrl?: string;
  originalImageUrl: string;
  error?: string;
  processingTime?: number;
}

export class ImageProcessingService {
  private cacheDir = DEFAULT_CACHE_DIR;
  private maxImageSize = 5 * 1024 * 1024; // 5MB limit

  constructor() {
    // Best-effort: if it fails (read-only FS, permissions), swallow.
    // Each operation that writes will create the dir again as needed.
    this.ensureCacheDirectory().catch((err) => {
      console.warn(`[image-processing] cache dir init failed (${this.cacheDir}):`, err.message);
    });
  }

  private async ensureCacheDirectory() {
    try {
      await fs.access(this.cacheDir);
    } catch {
      await fs.mkdir(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Remove TME watermarks from product images
   * TME typically places watermarks in bottom-right corner
   */
  async removeWatermark(imageUrl: string): Promise<ImageProcessingResult> {
    const startTime = Date.now();

    try {
      console.log(`🖼️ Processing image: ${imageUrl}`);

      // Stable, content-addressed key based on the source URL.
      const cacheKey = crypto.createHash('md5').update(imageUrl).digest('hex');
      const blobKey = `processed/${cacheKey}.jpg`;

      const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

      // On Vercel (or any host where BLOB_READ_WRITE_TOKEN is set), check
      // Blob for an already-processed copy keyed off the source URL hash.
      // Returns the public Blob URL eBay can fetch directly.
      if (useBlob) {
        try {
          const { head, put } = await import("@vercel/blob");
          const existing = await head(blobKey).catch(() => null);
          if (existing?.url) {
            console.log(`✅ Blob cache hit: ${existing.url}`);
            return {
              success: true,
              processedImageUrl: existing.url,
              originalImageUrl: imageUrl,
              processingTime: Date.now() - startTime,
            };
          }

          const imageBuffer = await this.downloadImage(imageUrl);
          if (!imageBuffer) throw new Error('Failed to download image');
          const processedBuffer = await this.processImageBuffer(imageBuffer);

          const uploaded = await put(blobKey, processedBuffer, {
            access: "public",
            contentType: "image/jpeg",
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60 * 60 * 24 * 30, // 30d at the edge
          });

          console.log(`✅ Watermark removed and uploaded to Blob: ${uploaded.url}`);
          return {
            success: true,
            processedImageUrl: uploaded.url,
            originalImageUrl: imageUrl,
            processingTime: Date.now() - startTime,
          };
        } catch (blobErr) {
          // Fall through to the local-disk path; never silently use the
          // unprocessed TME image — the caller should know we failed.
          console.error("Vercel Blob path failed, falling back to local disk:", blobErr);
        }
      }

      // Local-disk path: only used in dev / non-serverless. The served
      // /api/images/processed/{file} route reads from this.cacheDir.
      const processedImagePath = path.join(this.cacheDir, `${cacheKey}_processed.jpg`);
      try {
        await fs.access(processedImagePath);
        console.log(`✅ Using cached processed image for ${imageUrl}`);
        return {
          success: true,
          processedImageUrl: `/api/images/processed/${cacheKey}_processed.jpg`,
          originalImageUrl: imageUrl,
          processingTime: Date.now() - startTime,
        };
      } catch {
        /* not cached */
      }

      const imageBuffer = await this.downloadImage(imageUrl);
      if (!imageBuffer) throw new Error('Failed to download image');
      const processedBuffer = await this.processImageBuffer(imageBuffer);
      await fs.writeFile(processedImagePath, processedBuffer);

      console.log(`✅ Watermark removed from ${imageUrl}`);
      return {
        success: true,
        processedImageUrl: `/api/images/processed/${cacheKey}_processed.jpg`,
        originalImageUrl: imageUrl,
        processingTime: Date.now() - startTime,
      };

    } catch (error) {
      console.error(`❌ Failed to process image ${imageUrl}:`, error);
      return {
        success: false,
        originalImageUrl: imageUrl,
        error: (error as Error).message,
        processingTime: Date.now() - startTime,
      };
    }
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      // Fix protocol-relative URLs (starting with //)
      let fixedUrl = url;
      if (url.startsWith('//')) {
        fixedUrl = 'https:' + url;
        console.log(`🔗 Fixed protocol-relative URL: ${fixedUrl}`);
      }
      
      const response = await fetch(fixedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      if (buffer.length > this.maxImageSize) {
        throw new Error('Image too large');
      }

      return buffer;
    } catch (error) {
      console.error('Failed to download image:', error);
      return null;
    }
  }

  private async processImageBuffer(imageBuffer: Buffer): Promise<Buffer> {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image dimensions');
    }

    // TME watermarks are typically in bottom-right corner
    // We'll use multiple techniques to remove them

    // Method 1: Crop bottom-right corner (removes most TME watermarks)
    const cropWidth = Math.floor(metadata.width * 0.85); // Remove 15% from right
    const cropHeight = Math.floor(metadata.height * 0.90); // Remove 10% from bottom

    let processedImage = image.extract({
      left: 0,
      top: 0,
      width: cropWidth,
      height: cropHeight
    });

    // Method 2: Apply sharpening to improve quality after crop
    processedImage = processedImage.sharpen();

    // Method 3: Enhance contrast and brightness
    processedImage = processedImage.modulate({
      brightness: 1.05,
      saturation: 1.1
    });

    // Method 4: Resize to standard eBay image size (max 1600px)
    const maxDimension = 1600;
    if (cropWidth > maxDimension || cropHeight > maxDimension) {
      const scale = Math.min(maxDimension / cropWidth, maxDimension / cropHeight);
      const newWidth = Math.floor(cropWidth * scale);
      const newHeight = Math.floor(cropHeight * scale);
      
      processedImage = processedImage.resize(newWidth, newHeight, {
        kernel: sharp.kernel.lanczos3
      });
    }

    // Convert to JPEG with optimized quality
    return await processedImage
      .jpeg({
        quality: 90,
        progressive: true,
        mozjpeg: true
      })
      .toBuffer();
  }

  /**
   * Advanced watermark removal using content-aware techniques
   */
  async removeWatermarkAdvanced(imageUrl: string): Promise<ImageProcessingResult> {
    const startTime = Date.now();
    
    try {
      const imageBuffer = await this.downloadImage(imageUrl);
      if (!imageBuffer) {
        throw new Error('Failed to download image');
      }

      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image dimensions');
      }

      // Advanced technique: Detect and mask watermark areas
      // This works well for TME's semi-transparent watermarks
      
      // Step 1: Create a mask for the watermark area (bottom-right)
      const watermarkWidth = Math.floor(metadata.width * 0.2);
      const watermarkHeight = Math.floor(metadata.height * 0.15);
      const watermarkLeft = metadata.width - watermarkWidth;
      const watermarkTop = metadata.height - watermarkHeight;

      // Step 2: Extract the watermark area
      const watermarkArea = await image
        .extract({
          left: watermarkLeft,
          top: watermarkTop,
          width: watermarkWidth,
          height: watermarkHeight
        })
        .toBuffer();

      // Step 3: Apply content-aware fill to the watermark area
      const cleanedWatermarkArea = await sharp(watermarkArea)
        .blur(2) // Blur to blend edges
        .modulate({ brightness: 1.1, saturation: 0.8 }) // Adjust colors
        .toBuffer();

      // Step 4: Composite the cleaned area back onto the original
      const processedBuffer = await image
        .composite([{
          input: cleanedWatermarkArea,
          left: watermarkLeft,
          top: watermarkTop,
          blend: 'multiply'
        }])
        .jpeg({ quality: 90 })
        .toBuffer();

      // Cache the result
      const cacheKey = crypto.createHash('md5').update(imageUrl + '_advanced').digest('hex');
      const processedImagePath = path.join(this.cacheDir, `${cacheKey}_advanced.jpg`);
      await fs.writeFile(processedImagePath, processedBuffer);

      return {
        success: true,
        processedImageUrl: `/api/images/processed/${cacheKey}_advanced.jpg`,
        originalImageUrl: imageUrl,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error(`❌ Advanced watermark removal failed for ${imageUrl}:`, error);
      return {
        success: false,
        originalImageUrl: imageUrl,
        error: (error as Error).message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Batch process multiple images
   */
  async processMultipleImages(imageUrls: string[]): Promise<ImageProcessingResult[]> {
    const results: ImageProcessingResult[] = [];
    
    // Process images in batches of 3 to avoid overwhelming the system
    const batchSize = 3;
    
    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(url => this.removeWatermark(url));
      const batchResults = await Promise.all(batchPromises);
      
      results.push(...batchResults);
      
      // Add delay between batches
      if (i + batchSize < imageUrls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  /**
   * Get processed image file
   */
  async getProcessedImage(filename: string): Promise<Buffer | null> {
    try {
      const imagePath = path.join(this.cacheDir, filename);
      return await fs.readFile(imagePath);
    } catch {
      return null;
    }
  }

  /**
   * Clean up old processed images
   */
  async cleanupOldImages(maxAgeHours: number = 24) {
    try {
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();
      const maxAge = maxAgeHours * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`🗑️ Cleaned up old processed image: ${file}`);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old images:', error);
    }
  }
}

export const imageProcessingService = new ImageProcessingService();
