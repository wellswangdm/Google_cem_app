import { PricingItem, ItemSection, ExtraPricingMapping, ExtraPriceResult } from '../types';

export const parseCSV = (
  csv: string, 
  sourceName: string, 
  sourceId: string,
  section: ItemSection,
  descriptionCol?: string,
  priceCol?: string,
  subcategoryCol?: string,
  ecfPriceCol?: string,
  extraMappings?: ExtraPricingMapping[],
  chineseDescriptionCol?: string
): PricingItem[] => {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 1) return [];

  const parseLine = (line: string) => {
    const result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuote = !inQuote;
      else if (char === ',' && !inQuote) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  
  return lines.slice(1).map((line, index) => {
    if (!line.trim()) return null;
    const values = parseLine(line);
    
    const entry: any = {};
    headers.forEach((header, i) => {
      entry[header] = values[i];
    });

    let rawPrice = '0';
    if (priceCol && entry[priceCol]) {
      rawPrice = entry[priceCol];
    } else {
      rawPrice = entry['TOTAL PRICE W/ BASE'] || entry['TOTAL PRICE'] || entry['BRONZE PRICE'] || '0';
    }
    const cleanPrice = parseFloat(rawPrice.toString().replace(/[^0-9.]/g, '')) || 0;

    let cleanEcfPrice = 0;
    if (ecfPriceCol && ecfPriceCol !== "none" && entry[ecfPriceCol]) {
      cleanEcfPrice = parseFloat(entry[ecfPriceCol].toString().replace(/[^0-9.]/g, '')) || 0;
    }

    const extraPriceResults: ExtraPriceResult[] = [];
    if (extraMappings && extraMappings.length > 0) {
      extraMappings.forEach(m => {
        if (m.column && m.column !== 'none' && entry[m.column]) {
          const p = parseFloat(entry[m.column].toString().replace(/[^0-9.]/g, '')) || 0;
          if (p > 0) {
            // Treat m.name as a column selection. Pull dynamic value if column exists, else header string.
            const dynamicName = entry[m.name] || m.name;
            const dynamicChinese = (m.chineseColumn && entry[m.chineseColumn]) ? entry[m.chineseColumn] : dynamicName;
            
            extraPriceResults.push({ 
              name: dynamicName, 
              chineseName: dynamicChinese,
              price: p 
            });
          }
        }
      });
    }

    let name = '';
    if (descriptionCol && entry[descriptionCol]) {
      name = entry[descriptionCol];
    } else {
      name = entry['MARKER'] || entry['NAME'] || entry['PRODUCT'] || values[0] || `Row ${index + 1}`;
    }

    let chineseName = '';
    if (chineseDescriptionCol && entry[chineseDescriptionCol]) {
      chineseName = entry[chineseDescriptionCol];
    }

    let subcat = '';
    if (subcategoryCol && subcategoryCol !== "none" && entry[subcategoryCol]) {
      subcat = entry[subcategoryCol];
    }

    const sku = entry['HMIS CODE'] || entry['SKU'] || `M-${index}`;

    return {
      id: `item-${index}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      sku: sku,
      name: name,
      chineseName: chineseName,
      description: `${subcat} ${entry['MARKER SIZE'] || ''}`.trim(),
      price: cleanPrice,
      ecfPrice: cleanEcfPrice,
      extraPrices: extraPriceResults,
      unit: 'pc',
      category: subcat,
      sourceName: sourceName,
      sourceId: sourceId,
      section: section,
      index: index,
      metadata: {
        series: subcat,
        size: entry['MARKER SIZE'],
        hasVase: entry['VASE'] === 'YES',
        hmisCode: entry['HMIS CODE']
      }
    };
  }).filter(item => item !== null && item.name) as PricingItem[];
};

export const getHeaders = (csv: string): string[] => {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 1) return [];
  const line = lines[0];
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuote = !inQuote;
    else if (char === ',' && !inQuote) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim());
  return result.filter(h => h.length > 0);
};

export const getSampleData = (): PricingItem[] => [];