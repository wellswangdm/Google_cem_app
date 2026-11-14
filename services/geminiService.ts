
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { PricingItem, QuoteLineItem } from "../types";

/**
 * Processes natural language input to extract items and match them against the catalog.
 * Uses gemini-3-pro-preview for complex reasoning and semantic matching.
 */
export const processNaturalLanguageQuote = async (
  prompt: string, 
  pricingCatalog: PricingItem[]
): Promise<{ matchedItems: Partial<QuoteLineItem>[], note: string }> => {
  // Always use named parameter and obtain API key from environment
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Provide specific domain context to the AI
  const catalogContext = pricingCatalog.map(item => 
    `- ${item.name} / ${item.chineseName || ''} [SKU: ${item.sku}, Price: $${item.price}, Category: ${item.category}]`
  ).join('\n');

  // Use gemini-3-pro-preview for tasks requiring reasoning and catalog matching
  const response: GenerateContentResponse = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `You are an expert sales assistant for a monument and bronze marker company. 
    Your catalog includes markers of different series, sizes, and options for vases.
    
    IMPORTANT: All your responses (notes and suggestions) must be in Traditional Chinese (繁體中文).
    
    Catalog:
    ${catalogContext}
    
    Task: Extract the products and quantities from the user request. Match the user's description to the most appropriate catalog item.
    
    If you match an item, return the exact productId (SKU).
    
    User Request: "${prompt}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          matchedItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                chineseName: { type: Type.STRING, description: "Item name in Traditional Chinese" },
                quantity: { type: Type.NUMBER },
                productId: { type: Type.STRING, description: "The exact SKU from the catalog" }
              },
              required: ["name", "quantity", "productId"]
            }
          },
          note: { type: Type.STRING, description: "A summary of what was found in Traditional Chinese." }
        },
        required: ["matchedItems", "note"]
      }
    }
  });

  try {
    const text = response.text || "{}";
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse AI response:", e);
    return { matchedItems: [], note: "無法匹配項目。請更具體地說明系列或尺寸。AI 預估可能不準確，請務必手動核對。" };
  }
};
