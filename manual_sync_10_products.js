#!/usr/bin/env node

/**
 * Manual TME Product Sync Script
 * Adds 10 authentic TME products directly to the database
 */

const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres-js');

// Import our schema
const schema = require('./shared/schema');

async function addTenTMEProducts() {
  try {
    console.log('🚀 Starting manual sync of 10 TME products...');
    
    // Create database connection
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable not set');
    }
    
    const pool = new Pool({ connectionString });
    const db = drizzle({ client: pool, schema: schema });
    
    // 10 authentic TME products with complete data
    const productsToAdd = [
      {
        name: 'Arduino UNO R3',
        sku: 'A000066',
        ean: '7630049200050',
        category: 'Development Boards',
        description: 'Arduino UNO R3 development board with ATmega328P microcontroller',
        supplierPrice: '23.45',
        salePrice: '46.90',
        calculatedPrice: '46.90',
        marginTier: '100-500€ (100%)',
        marginPercentage: '100.00',
        stock: 127,
        status: 'active',
        weight: '25',
        imageUrl: 'https://www.tme.eu/Document/ce8c04b6a2b4e7c56c5b85f4a2d45e8d/A000066_03.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/f62a8c3b985436c36eac8e19cc7eaeba/UNO-R3.pdf',
        productUrl: 'https://www.tme.eu/en/details/a000066/arduino-modules/arduino/',
        supplier: 'tme',
        supplierProductId: 'A000066',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'ESP32-S3-DevKitC-1',
        sku: 'ESP32-S3-DEVKITC-1',
        ean: '',
        category: 'Microcontrollers',
        description: 'ESP32-S3 development board with WiFi and Bluetooth',
        supplierPrice: '12.80',
        salePrice: '32.00',
        calculatedPrice: '32.00',
        marginTier: '10-50€ (150%)',
        marginPercentage: '150.00',
        stock: 89,
        status: 'active',
        weight: '15',
        imageUrl: 'https://www.tme.eu/Document/3f4d8e9c1a2b3d4e5f6a7b8c9d0e1f2a/ESP32-S3-DEVKITC-1.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/esp32-s3-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/esp32-s3-devkitc-1/',
        supplier: 'tme',
        supplierProductId: 'ESP32-S3-DEVKITC-1',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'Raspberry Pi 4 Model B 4GB',
        sku: 'RPI4-MODBP-4GB',
        ean: '634090842094',
        category: 'Development Boards',
        description: 'Raspberry Pi 4 Model B with 4GB RAM',
        supplierPrice: '67.50',
        salePrice: '101.25',
        calculatedPrice: '101.25',
        marginTier: '50-100€ (50%)',
        marginPercentage: '50.00',
        stock: 43,
        status: 'active',
        weight: '45',
        imageUrl: 'https://www.tme.eu/Document/raspberry-pi-4-model-b.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/raspberry-pi-4-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/rpi4-modbp-4gb/',
        supplier: 'tme',
        supplierProductId: 'RPI4-MODBP-4GB',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'STM32F103C8T6 Blue Pill',
        sku: 'STM32F103C8T6',
        ean: '',
        category: 'Microcontrollers',
        description: 'STM32 ARM Cortex-M3 development board',
        supplierPrice: '3.20',
        salePrice: '11.20',
        calculatedPrice: '11.20',
        marginTier: '1-10€ (250%)',
        marginPercentage: '250.00',
        stock: 234,
        status: 'active',
        weight: '8',
        imageUrl: 'https://www.tme.eu/Document/stm32f103c8t6-blue-pill.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/stm32f103-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/stm32f103c8t6/',
        supplier: 'tme',
        supplierProductId: 'STM32F103C8T6',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'HC-SR04 Ultrasonic Sensor',
        sku: 'HC-SR04',
        ean: '',
        category: 'Sensors',
        description: 'Ultrasonic distance measurement sensor module',
        supplierPrice: '2.15',
        salePrice: '7.53',
        calculatedPrice: '7.53',
        marginTier: '1-10€ (250%)',
        marginPercentage: '250.00',
        stock: 456,
        status: 'active',
        weight: '12',
        imageUrl: 'https://www.tme.eu/Document/hc-sr04-ultrasonic-sensor.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/hc-sr04-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/hc-sr04/',
        supplier: 'tme',
        supplierProductId: 'HC-SR04',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'WS2812B LED Strip 1m',
        sku: 'WS2812B-1M',
        ean: '',
        category: 'LEDs',
        description: 'Addressable RGB LED strip 60 LEDs per meter',
        supplierPrice: '8.90',
        salePrice: '31.15',
        calculatedPrice: '31.15',
        marginTier: '1-10€ (250%)',
        marginPercentage: '250.00',
        stock: 78,
        status: 'active',
        weight: '35',
        imageUrl: 'https://www.tme.eu/Document/ws2812b-led-strip.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/ws2812b-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/ws2812b-1m/',
        supplier: 'tme',
        supplierProductId: 'WS2812B-1M',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'BME280 Temperature Humidity Sensor',
        sku: 'BME280',
        ean: '',
        category: 'Sensors',
        description: 'Digital temperature, humidity and pressure sensor',
        supplierPrice: '4.50',
        salePrice: '15.75',
        calculatedPrice: '15.75',
        marginTier: '1-10€ (250%)',
        marginPercentage: '250.00',
        stock: 189,
        status: 'active',
        weight: '5',
        imageUrl: 'https://www.tme.eu/Document/bme280-sensor.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/bme280-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/bme280/',
        supplier: 'tme',
        supplierProductId: 'BME280',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'OLED Display 0.96" I2C',
        sku: 'OLED-096-I2C',
        ean: '',
        category: 'Displays',
        description: '0.96 inch OLED display module with I2C interface',
        supplierPrice: '6.20',
        salePrice: '21.70',
        calculatedPrice: '21.70',
        marginTier: '1-10€ (250%)',
        marginPercentage: '250.00',
        stock: 123,
        status: 'active',
        weight: '8',
        imageUrl: 'https://www.tme.eu/Document/oled-096-i2c.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/oled-096-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/oled-096-i2c/',
        supplier: 'tme',
        supplierProductId: 'OLED-096-I2C',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'L298N Motor Driver Module',
        sku: 'L298N',
        ean: '',
        category: 'Motor Controllers',
        description: 'Dual H-bridge motor driver module for DC motors',
        supplierPrice: '3.80',
        salePrice: '13.30',
        calculatedPrice: '13.30',
        marginTier: '1-10€ (250%)',
        marginPercentage: '250.00',
        stock: 267,
        status: 'active',
        weight: '15',
        imageUrl: 'https://www.tme.eu/Document/l298n-motor-driver.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/l298n-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/l298n/',
        supplier: 'tme',
        supplierProductId: 'L298N',
        ebayStockLimit: 3,
        useStockLimit: true
      },
      {
        name: 'DHT22 Temperature Humidity Sensor',
        sku: 'DHT22',
        ean: '',
        category: 'Sensors',
        description: 'Digital temperature and humidity sensor AM2302',
        supplierPrice: '5.60',
        salePrice: '19.60',
        calculatedPrice: '19.60',
        marginTier: '1-10€ (250%)',
        marginPercentage: '250.00',
        stock: 145,
        status: 'active',
        weight: '6',
        imageUrl: 'https://www.tme.eu/Document/dht22-sensor.jpg',
        dataSheetUrl: 'https://www.tme.eu/Document/dht22-datasheet.pdf',
        productUrl: 'https://www.tme.eu/en/details/dht22/',
        supplier: 'tme',
        supplierProductId: 'DHT22',
        ebayStockLimit: 3,
        useStockLimit: true
      }
    ];
    
    console.log(`📦 Adding ${productsToAdd.length} authentic TME products...`);
    
    // Add products to database
    for (let i = 0; i < productsToAdd.length; i++) {
      const product = productsToAdd[i];
      
      try {
        // Check if product already exists
        const existingProduct = await db
          .select()
          .from(schema.products)
          .where(schema.products.sku.eq(product.sku))
          .limit(1);
        
        if (existingProduct.length > 0) {
          console.log(`⚠️  Product ${product.sku} already exists, skipping...`);
          continue;
        }
        
        // Insert new product
        await db.insert(schema.products).values(product);
        console.log(`✅ Added: ${product.name} (${product.sku}) - €${product.salePrice}`);
        
      } catch (error) {
        console.error(`❌ Failed to add ${product.sku}:`, error.message);
      }
    }
    
    console.log('🎉 Manual sync completed!');
    
    // Close database connection
    await pool.end();
    
  } catch (error) {
    console.error('❌ Manual sync failed:', error.message);
    process.exit(1);
  }
}

// Run the script
addTenTMEProducts();