/**
 * TME to eBay Category Mapping System
 * Maps TME product categories to appropriate eBay categories
 */

export interface CategoryMapping {
  tmeCategory: string;
  tmeCategoryKeywords: string[];
  ebayCategory: string;
  ebayCategoryName: string;
  confidence: number; // 1-10 scale
}

export const TME_EBAY_CATEGORY_MAPPINGS: CategoryMapping[] = [
  // Arduino and Development Boards
  {
    tmeCategory: "Development Boards",
    tmeCategoryKeywords: ["arduino", "development", "board", "evaluation", "dev board", "microcontroller board"],
    ebayCategory: "58277", // Electronic Components - Other
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Arduino Compatible",
    tmeCategoryKeywords: ["arduino", "uno", "nano", "mega", "leonardo", "pro mini"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other", 
    confidence: 10
  },

  // Microcontrollers and Processors
  {
    tmeCategory: "Microcontrollers",
    tmeCategoryKeywords: ["microcontroller", "mcu", "pic", "atmega", "esp32", "esp8266", "stm32"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },
  {
    tmeCategory: "Processors",
    tmeCategoryKeywords: ["processor", "cpu", "arm", "cortex", "risc"],
    ebayCategory: "58277", 
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },

  // Passive Components
  {
    tmeCategory: "Resistors",
    tmeCategoryKeywords: ["resistor", "resistance", "ohm", "carbon", "metal film", "precision"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "Capacitors",
    tmeCategoryKeywords: ["capacitor", "ceramic", "electrolytic", "tantalum", "film", "farad", "uf", "pf"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other", 
    confidence: 10
  },
  {
    tmeCategory: "Inductors",
    tmeCategoryKeywords: ["inductor", "coil", "choke", "henry", "ferrite"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },

  // Semiconductors
  {
    tmeCategory: "Transistors",
    tmeCategoryKeywords: ["transistor", "bjt", "fet", "mosfet", "jfet", "igbt", "npn", "pnp"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "Diodes",
    tmeCategoryKeywords: ["diode", "led", "zener", "schottky", "rectifier", "photodiode"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 10
  },
  {
    tmeCategory: "THT universal diodes",
    tmeCategoryKeywords: ["diode", "rectifying", "tht", "through hole", "universal", "silicon"],
    ebayCategory: "175673",
    ebayCategoryName: "Electronics Components - Semiconductors & Actives - Diodes", 
    confidence: 10
  },
  {
    tmeCategory: "SMD diodes",
    tmeCategoryKeywords: ["diode", "smd", "surface mount", "rectifying", "switching"],
    ebayCategory: "175673",
    ebayCategoryName: "Electronics Components - Semiconductors & Actives - Diodes",
    confidence: 10
  },
  {
    tmeCategory: "Integrated Circuits",
    tmeCategoryKeywords: ["ic", "integrated circuit", "amplifier", "regulator", "timer", "logic", "analog"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },

  // Sensors
  {
    tmeCategory: "Sensors",
    tmeCategoryKeywords: ["sensor", "temperature", "humidity", "pressure", "accelerometer", "gyroscope", "proximity"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },

  // Displays and Optoelectronics
  {
    tmeCategory: "Displays",
    tmeCategoryKeywords: ["display", "lcd", "oled", "tft", "segment", "matrix", "screen"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "LEDs",
    tmeCategoryKeywords: ["led", "light emitting", "rgb", "strip", "module"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },

  // Connectors and Hardware
  {
    tmeCategory: "Connectors",
    tmeCategoryKeywords: ["connector", "header", "socket", "terminal", "plug", "jack", "usb", "hdmi"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Cables",
    tmeCategoryKeywords: ["cable", "wire", "jumper", "dupont", "ribbon"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },

  // Switches and Controls
  {
    tmeCategory: "Switches",
    tmeCategoryKeywords: ["switch", "button", "toggle", "rotary", "push", "tactile"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Potentiometers",
    tmeCategoryKeywords: ["potentiometer", "variable resistor", "trim", "rotary", "linear"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 9
  },

  // Power Components
  {
    tmeCategory: "Power Supplies",
    tmeCategoryKeywords: ["power supply", "adapter", "converter", "regulator", "psu"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },
  {
    tmeCategory: "Batteries",
    tmeCategoryKeywords: ["battery", "cell", "lithium", "alkaline", "rechargeable"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },

  // Communication and Wireless
  {
    tmeCategory: "Communication",
    tmeCategoryKeywords: ["wifi", "bluetooth", "zigbee", "lora", "gsm", "gps", "antenna"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 8
  },

  // Tools and Equipment
  {
    tmeCategory: "Tools",
    tmeCategoryKeywords: ["soldering", "multimeter", "oscilloscope", "breadboard", "pcb"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 7
  },

  // Generic fallback for electronics
  {
    tmeCategory: "Electronics",
    tmeCategoryKeywords: ["electronic", "component", "part", "device"],
    ebayCategory: "58277",
    ebayCategoryName: "Electronic Components - Other",
    confidence: 5
  }
];

/**
 * Find the best eBay category for a TME product
 */
export function findEbayCategoryForTMEProduct(product: any): { categoryId: string; categoryName: string; confidence: number } {
  const productName = (product.name || "").toLowerCase();
  const productCategory = (product.category || "").toLowerCase();
  const productDescription = (product.description || "").toLowerCase();
  
  // Combine all text for keyword matching
  const searchText = `${productName} ${productCategory} ${productDescription}`;
  
  let bestMatch: CategoryMapping | null = null;
  let bestScore = 0;
  
  for (const mapping of TME_EBAY_CATEGORY_MAPPINGS) {
    let score = 0;
    
    // Exact category match gets highest score
    if (productCategory === mapping.tmeCategory.toLowerCase()) {
      score += mapping.confidence * 3; // Exact match priority
    }
    // Partial category match gets lower score  
    else if (productCategory.includes(mapping.tmeCategory.toLowerCase())) {
      score += mapping.confidence * 2;
    }
    
    // Keyword matches in product name/description
    for (const keyword of mapping.tmeCategoryKeywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        score += mapping.confidence;
      }
    }
    
    // Prefer more specific categories by giving bonus for longer category names
    if (mapping.tmeCategory.length > 15) {
      score += 1;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = mapping;
    }
  }
  
  // Default to generic electronics category if no good match
  const fallback = TME_EBAY_CATEGORY_MAPPINGS.find(m => m.tmeCategory === "Electronics")!;
  const result = bestMatch || fallback;
  
  return {
    categoryId: result.ebayCategory,
    categoryName: result.ebayCategoryName,
    confidence: bestMatch ? Math.min(10, bestScore) : 1
  };
}

/**
 * Get category mapping by TME category name
 */
export function getCategoryMappingByTME(tmeCategory: string): CategoryMapping | null {
  return TME_EBAY_CATEGORY_MAPPINGS.find(
    mapping => mapping.tmeCategory.toLowerCase() === tmeCategory.toLowerCase()
  ) || null;
}

/**
 * Get all available category mappings
 */
export function getAllCategoryMappings(): CategoryMapping[] {
  return TME_EBAY_CATEGORY_MAPPINGS;
}

/**
 * Validate if eBay category is supported
 */
export function isEbayCategorySupported(categoryId: string): boolean {
  return TME_EBAY_CATEGORY_MAPPINGS.some(mapping => mapping.ebayCategory === categoryId);
}

/**
 * Get category suggestions for a product
 */
export function getCategorySuggestions(product: any): CategoryMapping[] {
  const productName = (product.name || "").toLowerCase();
  const productCategory = (product.category || "").toLowerCase();
  const searchText = `${productName} ${productCategory}`;
  
  const suggestions = TME_EBAY_CATEGORY_MAPPINGS
    .map(mapping => {
      let relevance = 0;
      
      // Check category match
      if (productCategory.includes(mapping.tmeCategory.toLowerCase())) {
        relevance += 10;
      }
      
      // Check keyword matches
      for (const keyword of mapping.tmeCategoryKeywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          relevance += 1;
        }
      }
      
      return { ...mapping, relevance };
    })
    .filter(mapping => mapping.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5); // Top 5 suggestions
  
  return suggestions;
}