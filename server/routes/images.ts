import type { Express } from "express";
import { imageProcessingService } from "../image-processing";

/**
 * Image processing routes (watermark removal + processed-image serving),
 * extracted from the routes monolith. Behaviour is identical to the previous
 * inline handlers.
 */
export function registerImageRoutes(app: Express) {
  app.post('/api/images/process-watermark', async (req, res) => {
    try {
      const { imageUrl, advanced = false } = req.body;

      if (!imageUrl) {
        return res.status(400).json({ error: 'Image URL is required' });
      }

      console.log(`🖼️ Processing watermark removal for: ${imageUrl}`);

      const result = advanced
        ? await imageProcessingService.removeWatermarkAdvanced(imageUrl)
        : await imageProcessingService.removeWatermark(imageUrl);

      res.json(result);
    } catch (error) {
      console.error('Watermark removal failed:', error);
      res.status(500).json({
        error: 'Failed to process image',
        details: (error as Error).message
      });
    }
  });

  app.post('/api/images/process-batch', async (req, res) => {
    try {
      const { imageUrls } = req.body;

      if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        return res.status(400).json({ error: 'Array of image URLs is required' });
      }

      if (imageUrls.length > 20) {
        return res.status(400).json({ error: 'Maximum 20 images per batch' });
      }

      console.log(`🖼️ Processing batch watermark removal for ${imageUrls.length} images`);

      const results = await imageProcessingService.processMultipleImages(imageUrls);

      const summary = {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };

      res.json(summary);
    } catch (error) {
      console.error('Batch watermark removal failed:', error);
      res.status(500).json({
        error: 'Failed to process image batch',
        details: (error as Error).message
      });
    }
  });

  app.get('/api/images/processed/:filename', async (req, res) => {
    try {
      const { filename } = req.params;

      const imageBuffer = await imageProcessingService.getProcessedImage(filename);

      if (!imageBuffer) {
        return res.status(404).json({ error: 'Processed image not found' });
      }

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(imageBuffer);
    } catch (error) {
      console.error('Failed to serve processed image:', error);
      res.status(500).json({ error: 'Failed to serve image' });
    }
  });

  app.post('/api/images/cleanup', async (req, res) => {
    try {
      const { maxAgeHours = 24 } = req.body;

      await imageProcessingService.cleanupOldImages(maxAgeHours);

      res.json({
        success: true,
        message: `Cleaned up processed images older than ${maxAgeHours} hours`
      });
    } catch (error) {
      console.error('Image cleanup failed:', error);
      res.status(500).json({
        error: 'Failed to cleanup images',
        details: (error as Error).message
      });
    }
  });
}
