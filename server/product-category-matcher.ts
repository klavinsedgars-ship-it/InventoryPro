import { COMMON_ELECTRONICS_CATEGORIES } from './ebay-category-finder';

// Product keyword mapping to eBay categories
export const PRODUCT_CATEGORY_MAPPING = {
  // Arduino and Development Boards
  arduino: ['58277', '293', '58285', '42184'],
  microcontroller: ['58277', '293', '58285', '42184'],
  development: ['58277', '293', '58285'],
  board: ['58277', '293', '58285', '42184'],
  'raspberry pi': ['58277', '293', '58285'],
  esp32: ['58277', '293', '58285'],
  esp8266: ['58277', '293', '58285'],
  
  // Electronic Components
  resistor: ['155973', '58058', '58277'],
  capacitor: ['155973', '58058', '58277'],
  transistor: ['155973', '58058', '58277'],
  diode: ['155973', '58058', '58277'],
  led: ['155973', '58058', '1745'],
  sensor: ['155973', '58058', '92074'],
  module: ['92074', '155973', '58278'],
  
  // Integrated Circuits
  ic: ['181079', '155973', '58058'],
  chip: ['181079', '155973', '58058'],
  processor: ['181079', '175673'],
  microprocessor: ['181079', '175673'],
  
  // Computer Components
  cable: ['14927', '175673'],
  connector: ['14927', '175673', '155973'],
  adapter: ['14927', '175673'],
  usb: ['14927', '175673'],
  
  // Test Equipment
  multimeter: ['18961'],
  oscilloscope: ['18961'],
  tester: ['18961'],
  meter: ['18961'],
  
  // General Electronics
  electronic: ['155973', '58058', '11176'],
  circuit: ['58278', '155973', '58058'],
  kit: ['58277', '155973', '58278'],
  component: ['155973', '58058', '58277'],
  
  // Power & Batteries
  battery: ['1745', '155973'],
  power: ['155973', '58058', '1745'],
  supply: ['155973', '58058'],
  charger: ['1745', '14927'],
  
  // Audio/Video
  speaker: ['1745', '11176'],
  display: ['1745', '175673'],
  lcd: ['1745', '175673', '155973'],
  screen: ['1745', '175673']
};

// Category priority mapping (higher priority = more specific)
// ✅ VERIFIED WORKING LEAF CATEGORIES
export const CATEGORY_PRIORITY: { [key: string]: number } = {
  '58277': 10,  // Electronic Components - Other (✅ CONFIRMED WORKING LEAF CATEGORY!)
  '293': 9,     // Electronics (parent category - tested, not leaf)
  '42184': 8,   // Electronic Components (parent category - tested, not leaf)
  '58285': 7,   // Development Boards & Kits (parent category - tested, not leaf)
  '155973': 6,  // Electronic Components - General (parent category - tested, not leaf)
  '58058': 5,   // Electronic Components & Semiconductors (parent category - tested, not leaf)
  '4205': 4,    // Integrated Circuits/Chips (parent category - tested, not leaf)
  '85066': 3,   // Electrical Equipment & Supplies (parent category - tested, not leaf)
  '175673': 2,  // Computer Components & Parts (parent category - tested, not leaf)
  '31388': 2,   // Wholesale Lots - Electronics (parent category - tested, not leaf)
  '11176': 1    // Electronics - Other (parent category - tested, not leaf)
};

export function findBestCategoryForProduct(
  productTitle: string, 
  productDescription?: string,
  validCategories?: string[]
): string {
  const searchText = `${productTitle} ${productDescription || ''}`.toLowerCase();
  const words = searchText.split(/\s+/);
  
  const categoryScores = new Map<string, number>();
  
  // Score categories based on keyword matches
  for (const [keyword, categories] of Object.entries(PRODUCT_CATEGORY_MAPPING)) {
    const keywordWords = keyword.split(/\s+/);
    let matchScore = 0;
    
    // Check if all words in the keyword are present
    const allWordsMatch = keywordWords.every(keywordWord => 
      words.some(word => word.includes(keywordWord) || keywordWord.includes(word))
    );
    
    if (allWordsMatch) {
      // Score based on keyword specificity (longer keywords = higher score)
      matchScore = keyword.length * keywordWords.length;
      
      // Add points for categories that can handle this product type
      for (const categoryId of categories) {
        if (!validCategories || validCategories.includes(categoryId)) {
          const currentScore = categoryScores.get(categoryId) || 0;
          const priorityBonus = CATEGORY_PRIORITY[categoryId] || 0;
          categoryScores.set(categoryId, currentScore + matchScore + priorityBonus);
        }
      }
    }
  }
  
  // If no specific matches, find best general category
  if (categoryScores.size === 0) {
    const generalCategories = ['155973', '58058', '11176']; // General electronics categories
    for (const categoryId of generalCategories) {
      if (!validCategories || validCategories.includes(categoryId)) {
        const priority = CATEGORY_PRIORITY[categoryId] || 0;
        categoryScores.set(categoryId, priority);
      }
    }
  }
  
  // Return highest scoring category
  if (categoryScores.size > 0) {
    const bestCategory = Array.from(categoryScores.entries())
      .sort((a, b) => b[1] - a[1])[0][0];
    return bestCategory;
  }
  
  // Final fallback - use first valid category or a known working general category
  if (validCategories && validCategories.length > 0) {
    return validCategories[0];
  }
  
  return '155973'; // Electronic Components - General (most likely to work)
}

export function getCategoryInfo(categoryId: string) {
  const category = COMMON_ELECTRONICS_CATEGORIES.find(cat => cat.id === categoryId);
  return category || { id: categoryId, name: `Category ${categoryId}`, description: 'Unknown category' };
}

export function explainCategoryChoice(
  productTitle: string, 
  categoryId: string, 
  productDescription?: string
): string {
  const searchText = `${productTitle} ${productDescription || ''}`.toLowerCase();
  const categoryInfo = getCategoryInfo(categoryId);
  
  // Find which keywords triggered this category
  const matchedKeywords = [];
  for (const [keyword, categories] of Object.entries(PRODUCT_CATEGORY_MAPPING)) {
    if (categories.includes(categoryId) && searchText.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }
  
  if (matchedKeywords.length > 0) {
    return `Selected "${categoryInfo.name}" because product matches: ${matchedKeywords.join(', ')}`;
  }
  
  return `Selected "${categoryInfo.name}" as general electronics category`;
}

// Batch categorization for multiple products
export function categorizeBatch(products: Array<{title: string, description?: string}>, validCategories?: string[]) {
  return products.map(product => {
    const categoryId = findBestCategoryForProduct(product.title, product.description, validCategories);
    const explanation = explainCategoryChoice(product.title, categoryId, product.description);
    return {
      ...product,
      suggestedCategoryId: categoryId,
      explanation
    };
  });
}