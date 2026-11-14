
export type ItemSection = 'Property' | 'Merchandise and Services';

export interface BusinessInfo {
  name: string;
  address: string;
  email: string;
  phone: string;
}

export interface ExtraPricingMapping {
  name: string;
  column: string;
  chineseColumn?: string;
}

export interface ExtraPriceResult {
  name: string;
  chineseName?: string;
  price: number;
}

export interface PricingItem {
  id: string;
  sku: string;
  name: string;
  chineseName?: string;
  description: string;
  price: number;
  ecfPrice?: number;
  extraPrices?: ExtraPriceResult[]; 
  unit: string;
  category: string;
  sourceName: string;
  sourceId: string;
  section: ItemSection;
  index: number;
  metadata?: {
    series?: string;
    size?: string;
    hasVase?: boolean;
    hmisCode?: string;
  };
}

export interface QuoteLineItem {
  id: string;
  productId: string;
  name: string;
  chineseName?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  section: ItemSection;
  isGSTApplicable: boolean;
  isPSTApplicable: boolean;
  isDiscountable: boolean;
  isECFIncluded?: boolean; 
  isWaived?: boolean;
  metadata?: any;
}

export interface Quote {
  id: string;
  clientName: string;
  date: string;
  items: QuoteLineItem[];
  subtotal: number;
  discountPercent: number;
  manualDiscountAmount: number; 
  manualDiscountName: string;   
  gstRate: number;
  pstRate: number;
  gstTotal: number;
  pstTotal: number;
  grandTotal: number;
  status: 'draft' | 'final';
  terms: string;
  businessInfo: BusinessInfo;
  isMonthlyPaymentEnabled: boolean;
  depositAmount: number;
  interestRate: number;
  paymentMonths: number;
  monthlyPaymentAmount?: number;
  isChineseEnabled: boolean;
  imageUrl?: string;
  imageHeight?: number;
}

export interface QuoteTemplate extends Omit<Quote, 'id' | 'date' | 'status'> {
  id: string;
  template_name: string;
  last_updated: string;
}

export interface SheetSource {
  id: string;
  name: string;
  url?: string;
  fileName?: string;
  lastSync: string;
  isLocal: boolean;
  origin: 'local' | 'database';
  section: ItemSection;
  headers: string[];
  descriptionColumn?: string;
  chineseDescriptionColumn?: string;
  priceColumn?: string;
  subcategoryColumn?: string;
  ecfPriceColumn?: string;
  isECFIncluded?: boolean;
  extraMappings?: ExtraPricingMapping[]; 
  rawCsvData?: string;
}
