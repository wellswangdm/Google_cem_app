import { ItemSection, QuoteTemplate } from '../types';

export interface DatabaseSheetEntry {
  id: string;
  name: string;
  section: ItemSection;
  description: string;
  lastUpdated: string;
  csvData: string;
}

/**
 * ---------------------------------------------------------
 * SUPABASE CONNECTION CONFIGURATION
 * ---------------------------------------------------------
 */
const CLOUD_DB_CONFIG = {
  baseUrl: 'https://dxunlwkeijipoxiozxss.supabase.co/rest/v1', 
  apiKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4dW5sd2tlaWppcG94aW96eHNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNzI1MTksImV4cCI6MjA4MzY0ODUxOX0.Z13N-B4Btj6L-EV7SiGRW9iZM8yOcM3mkAqOImeFYvU' 
};

const getHeaders = () => ({
  'apikey': CLOUD_DB_CONFIG.apiKey,
  'Authorization': `Bearer ${CLOUD_DB_CONFIG.apiKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
});

const isConfigValid = () => {
  return CLOUD_DB_CONFIG.baseUrl.length > 0 && !CLOUD_DB_CONFIG.baseUrl.includes('your-project-id');
};

export const fetchDatabaseSheets = async (): Promise<DatabaseSheetEntry[]> => {
  if (!isConfigValid()) throw new Error("Supabase credentials not configured.");
  
  try {
    const response = await fetch(`${CLOUD_DB_CONFIG.baseUrl}/pricing_sheets?select=*&order=last_updated.desc`, {
      method: 'GET',
      headers: getHeaders()
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Cloud API Error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.map((row: any) => ({
      id: row.id.toString(),
      name: row.name,
      section: row.section as ItemSection,
      description: row.description || '',
      lastUpdated: row.last_updated || new Date().toISOString(),
      csvData: row.csv_data
    }));
  } catch (err: any) {
    console.error("Fetch Sheets Error:", err);
    throw err;
  }
};

/**
 * ---------------------------------------------------------
 * QUOTE TEMPLATES
 * ---------------------------------------------------------
 */

export const fetchTemplates = async (): Promise<QuoteTemplate[]> => {
  if (!isConfigValid()) throw new Error("Supabase credentials not configured.");
  
  try {
    const response = await fetch(`${CLOUD_DB_CONFIG.baseUrl}/quote_templates?select=*&order=last_updated.desc`, {
      method: 'GET',
      headers: getHeaders()
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to fetch templates. Make sure the table exists.");
    }
    
    const data = await response.json();
    return data.map((row: any) => ({
      id: row.id.toString(),
      template_name: row.template_name,
      clientName: row.client_name,
      items: row.items,
      subtotal: row.subtotal,
      discountPercent: row.discount_percent,
      manualDiscountAmount: row.manual_discount_amount,
      manualDiscountName: row.manual_discount_name,
      gstRate: row.gst_rate,
      pstRate: row.pst_rate,
      gstTotal: row.gst_total,
      pstTotal: row.pst_total,
      grandTotal: row.grand_total,
      terms: row.terms,
      businessInfo: row.business_info,
      isMonthlyPaymentEnabled: row.is_monthly_payment_enabled,
      depositAmount: row.deposit_amount,
      interestRate: row.interest_rate,
      paymentMonths: row.payment_months,
      monthlyPaymentAmount: row.monthly_payment_amount,
      isChineseEnabled: !!row.is_chinese_enabled,
      last_updated: row.last_updated
    }));
  } catch (err: any) {
    console.error("Fetch Templates Error:", err);
    throw err;
  }
};

export const saveTemplate = async (template: Omit<QuoteTemplate, 'id' | 'last_updated'>): Promise<QuoteTemplate> => {
  if (!isConfigValid()) throw new Error("Supabase credentials not configured.");
  
  const payload = {
    template_name: template.template_name,
    client_name: template.clientName,
    items: template.items,
    subtotal: template.subtotal,
    discount_percent: template.discountPercent,
    manual_discount_amount: template.manualDiscountAmount,
    manual_discount_name: template.manualDiscountName,
    gst_rate: template.gstRate,
    pst_rate: template.pstRate,
    gst_total: template.gstTotal,
    pst_total: template.pstTotal,
    grand_total: template.grandTotal,
    terms: template.terms,
    business_info: template.businessInfo,
    is_monthly_payment_enabled: template.isMonthlyPaymentEnabled,
    deposit_amount: template.depositAmount,
    interest_rate: template.interestRate,
    payment_months: template.paymentMonths,
    monthly_payment_amount: template.monthlyPaymentAmount,
    is_chinese_enabled: template.isChineseEnabled
  };

  try {
    const response = await fetch(`${CLOUD_DB_CONFIG.baseUrl}/quote_templates`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `Database Error: ${response.statusText}`);
    }

    const result = await response.json();
    const row = Array.isArray(result) ? result[0] : result;
    return { ...template, id: row.id.toString(), last_updated: row.last_updated };
  } catch (err: any) {
    console.error("Save Template Error:", err);
    throw err;
  }
};

export const deleteTemplateFromCloud = async (id: string): Promise<void> => {
  const response = await fetch(`${CLOUD_DB_CONFIG.baseUrl}/quote_templates?id=eq.${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!response.ok) throw new Error("Delete Error");
};

export const deleteSheetFromCloud = async (id: string): Promise<void> => {
  const response = await fetch(`${CLOUD_DB_CONFIG.baseUrl}/pricing_sheets?id=eq.${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!response.ok) throw new Error(`Delete Error`);
};

/**
 * ---------------------------------------------------------
 * GLOBAL SETTINGS
 * ---------------------------------------------------------
 */

export const fetchGlobalSettings = async (): Promise<any | null> => {
  if (!isConfigValid()) return null;
  try {
    const response = await fetch(`${CLOUD_DB_CONFIG.baseUrl}/app_settings?id=eq.global_config&select=*`, {
      method: 'GET',
      headers: getHeaders()
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.length > 0 ? data[0].config_data : null;
  } catch (err) {
    console.error("Fetch Settings Error:", err);
    return null;
  }
};

export const saveGlobalSettings = async (configData: any): Promise<void> => {
  if (!isConfigValid()) throw new Error("Supabase credentials not configured.");
  
  const payload = {
    id: 'global_config',
    config_data: configData,
    last_updated: new Date().toISOString()
  };

  try {
    const response = await fetch(`${CLOUD_DB_CONFIG.baseUrl}/app_settings`, {
      method: 'POST',
      headers: {
        ...getHeaders(),
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `Database Error: ${response.statusText}`);
    }
  } catch (err: any) {
    console.error("Save Settings Error:", err);
    throw err;
  }
};
