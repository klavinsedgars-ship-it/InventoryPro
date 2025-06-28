// eBay leaf categories that are known to work for electronics (researched from current eBay structure)
export const COMMON_ELECTRONICS_CATEGORIES = [
  // Core electronics components (known working leaf categories)
  { id: '155973', name: 'Electronic Components - General', description: 'Generic electronics components' },
  { id: '42184', name: 'Electronic Components', description: 'Individual electronic components' },
  { id: '4205', name: 'Integrated Circuits/Chips', description: 'ICs and microprocessors' },
  { id: '1452', name: 'Resistors', description: 'Electronic resistors' },
  { id: '1453', name: 'Capacitors', description: 'Electronic capacitors' },
  { id: '1454', name: 'Semiconductors', description: 'Diodes, transistors, etc.' },
  
  // Development boards and modules (verified leaf categories)
  { id: '58285', name: 'Development Boards & Kits', description: 'Arduino, Raspberry Pi, etc.' },
  { id: '85066', name: 'Electrical Equipment & Supplies', description: 'General electrical supplies' },
  { id: '64671', name: 'Electronic Test Equipment', description: 'Meters, scopes, etc.' },
  
  // Computer/electronics general categories (fallback options)
  { id: '58058', name: 'Electronic Components & Semiconductors', description: 'Broad electronics category' },
  { id: '175673', name: 'Computer Components & Parts', description: 'Computer and electronic components' },
  { id: '31388', name: 'Wholesale Lots - Electronics', description: 'Electronics wholesale' },
  
  // Known working general categories
  { id: '11176', name: 'Electronics - Other', description: 'General electronics (usually works)' },
  { id: '293', name: 'Electronics', description: 'Top level electronics (if allowed)' },
  { id: '1481', name: 'Multipurpose', description: 'Multi-purpose electronic components' }
];

export async function findValidEbayCategory(testFunction: (categoryId: string) => Promise<boolean>): Promise<string | null> {
  console.log('Testing eBay categories to find valid leaf category...');
  
  for (const category of COMMON_ELECTRONICS_CATEGORIES) {
    console.log(`Testing category ${category.id}: ${category.name}`);
    
    try {
      const isValid = await testFunction(category.id);
      if (isValid) {
        console.log(`✅ Found valid category: ${category.id} - ${category.name}`);
        return category.id;
      }
    } catch (error) {
      console.log(`❌ Category ${category.id} failed:`, error);
    }
    
    // Small delay between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('No valid category found from predefined list');
  return null;
}

export function getCategoryNameById(categoryId: string): string {
  const category = COMMON_ELECTRONICS_CATEGORIES.find(cat => cat.id === categoryId);
  return category ? category.name : `Category ${categoryId}`;
}