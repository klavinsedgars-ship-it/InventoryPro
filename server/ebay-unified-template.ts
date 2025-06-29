/**
 * Unified eBay Listing Template System
 * Creates consistent professional listings for all products
 */

import type { Product } from "@shared/schema";

export interface UnifiedTemplate {
  title: string;
  description: string;
  htmlDescription: string;
}

/**
 * Generate unified professional template for any product
 */
export function generateUnifiedEbayTemplate(product: Product): UnifiedTemplate {
  const specs = extractProductSpecs(product);
  const category = determineCategory(product);
  
  return {
    title: generateUnifiedTitle(product, specs),
    description: generateUnifiedDescription(product, specs, category),
    htmlDescription: generateUnifiedHtmlDescription(product, specs, category)
  };
}

/**
 * Generate consistent title format: Product Name - SKU | Brand | Fast UK Shipping
 */
function generateUnifiedTitle(product: Product, specs: any): string {
  const name = product.name || 'Electronic Component';
  const sku = product.sku ? ` - ${product.sku}` : '';
  const brand = specs.brand ? ` | ${specs.brand}` : '';
  
  let title = `${name}${sku}${brand} | Fast UK Shipping`;
  
  // Ensure eBay 80 character limit
  if (title.length > 80) {
    title = `${name}${sku} | UK Stock`.slice(0, 80);
  }
  
  return title;
}

/**
 * Generate unified description with consistent structure
 */
function generateUnifiedDescription(product: Product, specs: any, category: string): string {
  const sections = [];
  
  // Header with product name
  sections.push(`🔧 PROFESSIONAL ${(product.name || 'ELECTRONIC COMPONENT').toUpperCase()}`);
  sections.push('');
  
  // Key features (always the same structure)
  sections.push('✅ HIGH QUALITY ELECTRONIC COMPONENT');
  sections.push('✅ GENUINE MANUFACTURER SPECIFICATIONS');
  sections.push('✅ TECHNICAL DOCUMENTATION INCLUDED');
  sections.push('✅ SAME DAY DISPATCH FROM UK WAREHOUSE');
  sections.push('✅ PROFESSIONAL TECHNICAL SUPPORT');
  sections.push('');
  
  // Product description (from database)
  if (product.description) {
    sections.push('📝 PRODUCT DESCRIPTION:');
    sections.push(product.description);
    sections.push('');
  }
  
  // Technical specifications
  sections.push('📋 TECHNICAL SPECIFICATIONS:');
  if (product.sku) sections.push(`• SKU: ${product.sku}`);
  if (product.ean) sections.push(`• EAN: ${product.ean}`);
  if (specs.voltage) sections.push(`• Voltage: ${specs.voltage}V`);
  if (specs.current) sections.push(`• Current: ${specs.current}A`);
  if (specs.power) sections.push(`• Power: ${specs.power}W`);
  if (specs.frequency) sections.push(`• Frequency: ${specs.frequency}MHz`);
  if (specs.temperature) sections.push(`• Operating Temperature: ${specs.temperature}°C`);
  if (product.category) sections.push(`• Category: ${product.category}`);
  sections.push('');
  
  // Package contents
  sections.push('📦 PACKAGE INCLUDES:');
  sections.push(`• 1x ${product.name || 'Electronic Component'}`);
  sections.push('• Technical Documentation');
  sections.push('• Quality Certificate');
  sections.push('');
  
  // Applications (category-specific but consistent format)
  const applications = getCategoryApplications(category);
  if (applications.length > 0) {
    sections.push('💡 TYPICAL APPLICATIONS:');
    applications.forEach(app => sections.push(`• ${app}`));
    sections.push('');
  }
  
  // Quality assurance (same for all products)
  sections.push('🛡️ QUALITY ASSURANCE:');
  sections.push('• All products tested before dispatch');
  sections.push('• Genuine components from authorized suppliers');
  sections.push('• 30-day return guarantee');
  sections.push('• 12-month manufacturer warranty');
  sections.push('');
  
  // Shipping (same for all products)
  sections.push('🚚 SHIPPING INFORMATION:');
  sections.push('• Same day dispatch (orders before 2PM)');
  sections.push('• Free UK shipping on orders over £20');
  sections.push('• Tracked delivery available');
  sections.push('• International shipping available');
  sections.push('');
  
  // Footer (same for all products)
  sections.push('🏢 ABOUT US:');
  sections.push('Professional electronics supplier serving makers, engineers, and hobbyists.');
  sections.push('Specializing in high-quality electronic components with expert support.');
  sections.push('');
  sections.push('📞 NEED HELP? Contact our technical support team for assistance.');
  sections.push('🔒 SECURE PAYMENT: All major payment methods accepted.');
  
  return sections.join('\n');
}

/**
 * Generate HTML version with consistent styling
 */
function generateUnifiedHtmlDescription(product: Product, specs: any, category: string): string {
  const applications = getCategoryApplications(category);
  
  // Build eBay-compatible HTML with simpler styling (no CSS grid, gradients, etc.)
  const html = `
<div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; color: #333;">
  
  <!-- Header -->
  <div style="background-color: #0066cc; color: white; padding: 15px; text-align: center; margin-bottom: 15px;">
    <h2 style="font-size: 20px; margin: 0;">🔧 PROFESSIONAL ${(product.name || 'ELECTRONIC COMPONENT').toUpperCase()}</h2>
  </div>
  
  <!-- Quality Features -->
  <div style="background-color: #f0f8ff; border: 2px solid #0066cc; padding: 15px; margin-bottom: 15px;">
    <div style="font-weight: bold; color: #006600;">
      ✅ HIGH QUALITY ELECTRONIC COMPONENT<br>
      ✅ GENUINE MANUFACTURER SPECIFICATIONS<br>
      ✅ TECHNICAL DOCUMENTATION INCLUDED<br>
      ✅ SAME DAY DISPATCH FROM UK WAREHOUSE<br>
      ✅ PROFESSIONAL TECHNICAL SUPPORT<br>
      ✅ 30-DAY RETURN GUARANTEE
    </div>
  </div>
  
  ${product.description ? `
  <!-- Product Description -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">📝 PRODUCT DESCRIPTION</h3>
    <p style="margin: 0; line-height: 1.4;">${product.description}</p>
  </div>
  ` : ''}
  
  <!-- Technical Specifications -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">📋 TECHNICAL SPECIFICATIONS</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      ${product.sku ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">SKU:</td><td style="padding: 3px 5px;">${product.sku}</td></tr>` : ''}
      ${product.ean ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">EAN:</td><td style="padding: 3px 5px;">${product.ean}</td></tr>` : ''}
      ${specs.voltage ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Voltage:</td><td style="padding: 3px 5px;">${specs.voltage}V</td></tr>` : ''}
      ${specs.current ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Current:</td><td style="padding: 3px 5px;">${specs.current}A</td></tr>` : ''}
      ${specs.power ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Power:</td><td style="padding: 3px 5px;">${specs.power}W</td></tr>` : ''}
      ${specs.frequency ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Frequency:</td><td style="padding: 3px 5px;">${specs.frequency}MHz</td></tr>` : ''}
      ${specs.temperature ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Operating Temperature:</td><td style="padding: 3px 5px;">${specs.temperature}°C</td></tr>` : ''}
      ${product.category ? `<tr><td style="padding: 3px 5px; font-weight: bold; width: 40%;">Category:</td><td style="padding: 3px 5px;">${product.category}</td></tr>` : ''}
    </table>
  </div>
  
  <!-- Package Contents -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">📦 PACKAGE INCLUDES</h3>
    <ul style="margin: 5px 0; padding-left: 20px;">
      <li>1x ${product.name || 'Electronic Component'}</li>
      <li>Technical Documentation</li>
      <li>Quality Certificate</li>
    </ul>
  </div>
  
  ${applications.length > 0 ? `
  <!-- Applications -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">💡 TYPICAL APPLICATIONS</h3>
    <ul style="margin: 5px 0; padding-left: 20px;">
      ${applications.map(app => `<li>${app}</li>`).join('')}
    </ul>
  </div>
  ` : ''}
  
  <!-- Quality Assurance -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">🛡️ QUALITY ASSURANCE</h3>
    <ul style="margin: 5px 0; padding-left: 20px; font-size: 14px;">
      <li>All products tested before dispatch</li>
      <li>Genuine components from authorized suppliers</li>
      <li>30-day return guarantee</li>
      <li>12-month manufacturer warranty</li>
    </ul>
  </div>
  
  <!-- Shipping Information -->
  <div style="background-color: #ffffff; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0; border-bottom: 1px solid #0066cc;">🚚 SHIPPING INFORMATION</h3>
    <ul style="margin: 5px 0; padding-left: 20px; font-size: 14px;">
      <li>Same day dispatch (orders before 2PM)</li>
      <li>Free UK shipping on orders over £20</li>
      <li>Tracked delivery available</li>
      <li>International shipping available</li>
    </ul>
  </div>
  
  <!-- About Us -->
  <div style="background-color: #f8f9fa; border: 1px solid #cccccc; padding: 15px; margin-bottom: 15px;">
    <h3 style="color: #0066cc; font-size: 16px; margin: 0 0 10px 0;">🏢 ABOUT US</h3>
    <p style="margin: 0; font-size: 14px; line-height: 1.4;">Professional electronics supplier serving makers, engineers, and hobbyists. Specializing in high-quality electronic components with expert support.</p>
  </div>
  
  <!-- Contact Footer -->
  <div style="background-color: #0066cc; color: white; padding: 15px; text-align: center;">
    <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">📞 NEED HELP? Contact our technical support team for assistance.</div>
    <div style="font-size: 16px; font-weight: bold;">🔒 SECURE PAYMENT: All major payment methods accepted.</div>
  </div>
  
</div>`;
  
  return html;
}

/**
 * Extract specifications from product data
 */
function extractProductSpecs(product: Product): any {
  const specs: any = {};
  const text = `${product.name || ''} ${product.description || ''}`.toLowerCase();
  
  // Extract voltage
  const voltageMatch = text.match(/(\d+(?:\.\d+)?)\s*v(?:olt)?/i);
  if (voltageMatch) specs.voltage = voltageMatch[1];
  
  // Extract current
  const currentMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ma|a|amp)/i);
  if (currentMatch) specs.current = currentMatch[1];
  
  // Extract power
  const powerMatch = text.match(/(\d+(?:\.\d+)?)\s*w(?:att)?/i);
  if (powerMatch) specs.power = powerMatch[1];
  
  // Extract frequency
  const freqMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hz|khz|mhz|ghz)/i);
  if (freqMatch) specs.frequency = freqMatch[1];
  
  // Extract temperature
  const tempMatch = text.match(/(-?\d+(?:\.\d+)?)\s*°?c/i);
  if (tempMatch) specs.temperature = tempMatch[1];
  
  // Extract brand
  if (text.includes('arduino')) specs.brand = 'Arduino';
  if (text.includes('esp32')) specs.brand = 'Espressif';
  if (text.includes('raspberry')) specs.brand = 'Raspberry Pi Foundation';
  
  return specs;
}

/**
 * Determine product category for applications
 */
function determineCategory(product: Product): string {
  const text = `${product.name || ''} ${product.description || ''} ${product.category || ''}`.toLowerCase();
  
  if (text.includes('arduino') || text.includes('microcontroller') || text.includes('esp32')) return 'Microcontrollers';
  if (text.includes('sensor') || text.includes('temperature') || text.includes('humidity')) return 'Sensors';
  if (text.includes('led') || text.includes('light') || text.includes('strip')) return 'LED & Lighting';
  if (text.includes('resistor') || text.includes('capacitor') || text.includes('inductor')) return 'Passive Components';
  if (text.includes('power') || text.includes('supply') || text.includes('battery')) return 'Power Management';
  if (text.includes('display') || text.includes('lcd') || text.includes('oled')) return 'Displays';
  
  return 'Electronics';
}

/**
 * Get applications for category (consistent for all products in category)
 */
function getCategoryApplications(category: string): string[] {
  const applicationMap: Record<string, string[]> = {
    'Microcontrollers': [
      'IoT and smart device projects',
      'Robotics and automation systems',
      'Educational and learning projects',
      'Prototyping and development',
      'Home automation systems'
    ],
    'Sensors': [
      'Environmental monitoring systems',
      'Weather stations and data logging',
      'Security and alarm systems',
      'Industrial automation',
      'Scientific measurement devices'
    ],
    'LED & Lighting': [
      'Decorative and ambient lighting',
      'Status indicators and displays',
      'Automotive lighting projects',
      'Architectural lighting systems',
      'Art and creative installations'
    ],
    'Passive Components': [
      'Circuit protection and filtering',
      'Signal conditioning circuits',
      'Power supply circuits',
      'Audio and RF applications',
      'Timing and oscillator circuits'
    ],
    'Power Management': [
      'Battery charging systems',
      'Voltage regulation circuits',
      'Solar power projects',
      'Portable device power supplies',
      'Energy harvesting applications'
    ],
    'Displays': [
      'Information displays and HMI',
      'Data visualization projects',
      'Digital signage systems',
      'Instrument panels',
      'Interactive displays'
    ]
  };
  
  return applicationMap[category] || [
    'Electronic circuit design',
    'Prototyping and development',
    'Educational projects',
    'Repair and maintenance',
    'Professional applications'
  ];
}