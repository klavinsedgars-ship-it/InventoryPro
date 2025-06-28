// Common eBay leaf categories for electronics and Arduino products
export const COMMON_ELECTRONICS_CATEGORIES = [
  { id: '155973', name: 'Electronic Components - General', description: 'Generic electronics components' },
  { id: '175673', name: 'Computer Components & Parts', description: 'Computer and electronic components' },
  { id: '58058', name: 'Electronic Components & Semiconductors', description: 'Electronic components and semiconductors' },
  { id: '58277', name: 'Electronic Components - Mixed Lots', description: 'Mixed electronic components' },
  { id: '172524', name: 'Arduino Compatible', description: 'Arduino and compatible boards' },
  { id: '38268', name: 'Development Boards', description: 'Microcontroller development boards' },
  { id: '11176', name: 'Electronics - Other', description: 'Other electronics items' },
  { id: '1659', name: 'Electronics', description: 'General electronics category' },
  { id: '14927', name: 'Computer Cables & Connectors', description: 'Computer cables and connectors' },
  { id: '181079', name: 'Integrated Circuits (ICs)', description: 'Integrated circuits and microprocessors' },
  { id: '18961', name: 'Electronic Test Equipment', description: 'Electronic testing equipment' },
  { id: '92074', name: 'Electronic Modules', description: 'Electronic modules and breakout boards' },
  { id: '1745', name: 'Consumer Electronics', description: 'Consumer electronic devices' },
  { id: '58278', name: 'Circuit Boards & Prototyping', description: 'Circuit boards and prototyping materials' }
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