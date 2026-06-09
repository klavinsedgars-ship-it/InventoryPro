/**
 * Professional eBay Listing Template Generator
 * Creates compelling, SEO-optimized listings with TME product data
 */

import type { Product } from "@shared/schema";

export interface ListingTemplate {
  title: string;
  description: string;
  htmlDescription: string;
  subtitle?: string;
  keywords: string[];
}

export interface ProductSpecs {
  [key: string]: string | number;
}

/**
 * Generate professional eBay listing from TME product data
 */
export function generateEbayListing(product: Product): ListingTemplate {
  const specs = parseProductSpecs(product);
  const category = determineProductCategory(product);
  
  return {
    title: generateTitle(product, specs),
    description: generateDescription(product, specs, category),
    htmlDescription: generateHtmlDescription(product, specs, category),
    subtitle: generateSubtitle(product, specs),
    keywords: generateKeywords(product, specs, category)
  };
}

/**
 * Generate SEO-optimized title (80 character limit)
 */
function generateTitle(product: Product, specs: ProductSpecs): string {
  let name = product.name || 'Electronic Component';
  const manufacturer = specs.manufacturer || specs.brand || '';
  const model = specs.model || specs.partNumber || '';
  const category = specs.category || 'Electronics';
  
  // Handle multipack products - ensure quantity is in title. TME's MOQ > 1
  // means the item is sold only in packs of that size.
  const packQty = product.moq ?? 1;
  if (packQty > 1) {
    // If title doesn't already contain quantity prefix, add it
    if (!name.match(/^\d+x\s/)) {
      name = `${packQty}x ${name}`;
    }
  }
  
  // Build title components
  const components = [
    name,
    model ? `- ${model}` : '',
    manufacturer ? `| ${manufacturer}` : '',
    '| Fast EU Shipping'
  ].filter(Boolean);
  
  let title = components.join(' ');
  
  // Ensure title doesn't exceed 80 characters
  if (title.length > 80) {
    title = `${name} ${model} | ${manufacturer} | EU Stock`.slice(0, 80);
  }
  
  return title;
}

/**
 * Generate compelling subtitle (55 character limit)
 */
function generateSubtitle(product: Product, specs: ProductSpecs): string {
  const features = [];
  
  if (specs.voltage) features.push(`${specs.voltage}V`);
  if (specs.current) features.push(`${specs.current}A`);
  if (specs.power) features.push(`${specs.power}W`);
  if (specs.frequency) features.push(`${specs.frequency}Hz`);
  
  const subtitle = features.length > 0 
    ? `Professional Grade | ${features.slice(0, 2).join(' | ')}`
    : 'Professional Electronics | Fast Dispatch';
    
  return subtitle.slice(0, 55);
}

/**
 * Generate comprehensive product description
 */
function generateDescription(product: Product, specs: ProductSpecs, category: string): string {
  const sections = [];
  
  // Header section
  sections.push(`🔧 PROFESSIONAL ${(product.name || '').toUpperCase()}`);
  sections.push('✅ High quality electronic component');
  sections.push('✅ Genuine manufacturer specifications');
  sections.push('✅ Technical documentation included');
  sections.push('✅ Dispatch from EU warehouse within 2-3 days');
  sections.push('');
  
  // Technical specifications
  sections.push('📋 TECHNICAL SPECIFICATIONS:');
  Object.entries(specs).forEach(([key, value]) => {
    if (value && isValidSpec(key)) {
      sections.push(`• ${formatSpecName(key)}: ${value}`);
    }
  });
  sections.push('');
  
  // Manufacturer information
  sections.push('🏭 MANUFACTURER INFORMATION:');
  if (specs.manufacturer) sections.push(`Brand: ${specs.manufacturer}`);
  if (specs.model) sections.push(`Model: ${specs.model}`);
  if (specs.partNumber) sections.push(`Part Number: ${specs.partNumber}`);
  if (product.sku) sections.push(`SKU: ${product.sku}`);
  if (product.ean) sections.push(`EAN: ${product.ean}`);
  sections.push('');
  
  // Package contents - handle multipack products
  sections.push('📦 PACKAGE CONTENTS:');
  
  const packQty = product.moq ?? 1;
  if (packQty > 1) {
    // For multipack products, emphasize the pack quantity
    const baseProductName = product.name?.replace(/^\d+x\s/, '') || 'Electronic Component';
    sections.push(`**THIS IS A PACK OF ${packQty} PIECES**`);
    sections.push(`• ${packQty}x ${baseProductName}`);
    sections.push(`• Sold as a complete pack only`);
    sections.push(`• Cannot be split or sold individually`);
    const perPiecePrice = (parseFloat(product.salePrice) / packQty).toFixed(2);
    sections.push(`• Effective price per piece: €${perPiecePrice}`);
  } else {
    // For single products
    sections.push(`• 1x ${product.name || 'Electronic Component'}`);
  }
  
  if (specs.accessories) {
    specs.accessories.toString().split(',').forEach(accessory => {
      sections.push(`• ${accessory.trim()}`);
    });
  }
  sections.push('• Technical datasheet (PDF)');
  sections.push('');
  
  // Applications (category-specific)
  const applications = getApplications(category);
  if (applications.length > 0) {
    sections.push('💡 TYPICAL APPLICATIONS:');
    applications.forEach(app => sections.push(`• ${app}`));
    sections.push('');
  }
  
  // Footer
  sections.push('🚚 FAST EU SHIPPING | 📞 TECHNICAL SUPPORT | 💯 QUALITY GUARANTEE');
  sections.push('');
  sections.push('Professional electronics supplier serving makers, engineers, and hobbyists.');
  sections.push('All products tested and verified before dispatch.');
  
  return sections.join('\n');
}

/**
 * Generate HTML description for rich formatting
 */
function generateHtmlDescription(product: Product, specs: ProductSpecs, category: string): string {
  const plainDescription = generateDescription(product, specs, category);
  
  // Convert to HTML with basic formatting
  let html = plainDescription
    .replace(/🔧 PROFESSIONAL (.*)/g, '<h2 style="color: #0066cc;">🔧 $1</h2>')
    .replace(/📋 TECHNICAL SPECIFICATIONS:/g, '<h3 style="color: #333;">📋 TECHNICAL SPECIFICATIONS:</h3>')
    .replace(/🏭 MANUFACTURER INFORMATION:/g, '<h3 style="color: #333;">🏭 MANUFACTURER INFORMATION:</h3>')
    .replace(/📦 PACKAGE CONTENTS:/g, '<h3 style="color: #333;">📦 PACKAGE CONTENTS:</h3>')
    .replace(/💡 TYPICAL APPLICATIONS:/g, '<h3 style="color: #333;">💡 TYPICAL APPLICATIONS:</h3>')
    .replace(/✅ (.*)/g, '<div style="color: #009900;">✅ $1</div>')
    .replace(/• (.*)/g, '<li>$1</li>')
    .replace(/\n\n/g, '</ul><br><ul>')
    .replace(/\n/g, '');
  
  // Wrap in professional styling
  return `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
      ${html}
      <br><br>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; text-align: center;">
        <strong>🚚 FAST EU SHIPPING | 📞 TECHNICAL SUPPORT | 💯 QUALITY GUARANTEE</strong>
      </div>
    </div>
  `;
}

/**
 * Generate SEO keywords for eBay search
 */
function generateKeywords(product: Product, specs: ProductSpecs, category: string): string[] {
  const keywords = new Set<string>();
  
  // Product name keywords
  if (product.name) {
    product.name.split(/\s+/).forEach(word => {
      if (word.length > 2) keywords.add(word.toLowerCase());
    });
  }
  
  // Technical keywords
  Object.values(specs).forEach(value => {
    if (typeof value === 'string' && value.length > 2) {
      keywords.add(value.toLowerCase());
    }
  });
  
  // Category keywords
  keywords.add(category.toLowerCase());
  keywords.add('electronics');
  keywords.add('component');
  keywords.add('arduino');
  keywords.add('raspberry pi');
  keywords.add('diy');
  keywords.add('maker');
  keywords.add('engineering');
  
  return Array.from(keywords).slice(0, 20); // eBay limit
}

/**
 * Parse product specifications from description or name
 */
function parseProductSpecs(product: Product): ProductSpecs {
  const specs: ProductSpecs = {};
  
  // Extract common specifications from product data
  const text = `${product.name || ''} ${product.description || ''}`.toLowerCase();
  
  // Voltage patterns
  const voltageMatch = text.match(/(\d+(?:\.\d+)?)\s*v(?:olt)?/i);
  if (voltageMatch) specs.voltage = voltageMatch[1];
  
  // Current patterns
  const currentMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ma|a|amp)/i);
  if (currentMatch) specs.current = currentMatch[1];
  
  // Power patterns
  const powerMatch = text.match(/(\d+(?:\.\d+)?)\s*w(?:att)?/i);
  if (powerMatch) specs.power = powerMatch[1];
  
  // Frequency patterns
  const freqMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hz|khz|mhz|ghz)/i);
  if (freqMatch) specs.frequency = freqMatch[1];
  
  // Temperature patterns
  const tempMatch = text.match(/(-?\d+(?:\.\d+)?)\s*°?c/i);
  if (tempMatch) specs.operatingTemp = tempMatch[1];
  
  // Extract manufacturer/brand from various fields
  if (product.description?.includes('Arduino')) specs.manufacturer = 'Arduino';
  if (product.description?.includes('Raspberry')) specs.manufacturer = 'Raspberry Pi Foundation';
  if (product.name?.includes('ESP32')) specs.manufacturer = 'Espressif';
  
  // Use SKU as part number if available
  if (product.sku) specs.partNumber = product.sku;
  if (product.ean) specs.ean = product.ean;
  
  return specs;
}

/**
 * Determine product category for targeted applications
 */
function determineProductCategory(product: Product): string {
  const text = `${product.name || ''} ${product.description || ''}`.toLowerCase();
  
  if (text.includes('arduino') || text.includes('microcontroller')) return 'Microcontrollers';
  if (text.includes('sensor') || text.includes('temperature') || text.includes('humidity')) return 'Sensors';
  if (text.includes('led') || text.includes('light')) return 'LED & Lighting';
  if (text.includes('resistor') || text.includes('capacitor') || text.includes('inductor')) return 'Passive Components';
  if (text.includes('ic') || text.includes('chip') || text.includes('processor')) return 'Integrated Circuits';
  if (text.includes('connector') || text.includes('cable') || text.includes('wire')) return 'Connectors & Cables';
  if (text.includes('power') || text.includes('supply') || text.includes('battery')) return 'Power Management';
  if (text.includes('display') || text.includes('lcd') || text.includes('oled')) return 'Displays';
  
  return 'Electronics';
}

/**
 * Get typical applications for category
 */
function getApplications(category: string): string[] {
  const applicationMap: Record<string, string[]> = {
    'Microcontrollers': [
      'IoT projects and smart devices',
      'Robotics and automation',
      'Prototyping and development',
      'Educational projects',
      'Home automation systems'
    ],
    'Sensors': [
      'Environmental monitoring',
      'Weather stations',
      'Security systems',
      'Industrial automation',
      'Scientific instruments'
    ],
    'LED & Lighting': [
      'Indicator lights',
      'Decorative lighting',
      'Status displays',
      'Automotive applications',
      'Architectural lighting'
    ],
    'Passive Components': [
      'Circuit protection',
      'Signal filtering',
      'Power conditioning',
      'Timing circuits',
      'Impedance matching'
    ],
    'Power Management': [
      'Battery charging',
      'Voltage regulation',
      'Power conversion',
      'Energy harvesting',
      'Portable devices'
    ]
  };
  
  return applicationMap[category] || [
    'Electronic projects',
    'Prototyping',
    'Repair and maintenance',
    'Educational use',
    'Professional development'
  ];
}

/**
 * Check if specification key is relevant for display
 */
function isValidSpec(key: string): boolean {
  const irrelevantKeys = ['id', 'createdAt', 'updatedAt', 'description', 'name'];
  return !irrelevantKeys.includes(key) && key.length > 1;
}

/**
 * Format specification name for display
 */
function formatSpecName(key: string): string {
  const nameMap: Record<string, string> = {
    'partNumber': 'Part Number',
    'operatingTemp': 'Operating Temperature',
    'voltage': 'Operating Voltage',
    'current': 'Current Rating',
    'power': 'Power Rating',
    'frequency': 'Frequency',
    'manufacturer': 'Manufacturer',
    'model': 'Model',
    'ean': 'EAN Code'
  };
  
  return nameMap[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
}

/**
 * Generate category-specific condition description
 */
export function generateConditionDescription(category: string): string {
  return 'New: A brand-new, unused, unopened, undamaged item in its original packaging (where packaging is applicable).';
}

/**
 * Generate shipping template text
 */
export function generateShippingTemplate(): string {
  return `
🚚 SHIPPING FROM EU:
• Usually dispatch in 2-3 days after order placed
• Express delivery available for additional fee
• Tracked delivery available

📦 PACKAGING:
• Anti-static packaging for sensitive components
• Tracked and insured delivery
• Secure packaging to prevent damage

🌍 INTERNATIONAL SHIPPING:
• Germany & EU: 3-7 working days
• Worldwide: 7-14 working days
  `;
}

/**
 * Generate return policy template
 */
export function generateReturnPolicy(): string {
  return `
🔄 30-DAY RETURN POLICY:
• Full refund if not satisfied
• Return shipping covered for defective items
• Original packaging not required
• No restocking fees

🛡️ QUALITY GUARANTEE:
• Technical support included
• Replacement guarantee for DOA items
  `;
}