import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PricingItem, Quote, QuoteLineItem, SheetSource, ItemSection, ExtraPricingMapping, QuoteTemplate, BusinessInfo } from './types';
import Sidebar from './components/Sidebar';
import QuoteTable from './components/QuoteTable';
import { getSampleData, parseCSV, getHeaders } from './services/sheetService';
import { fetchDatabaseSheets, deleteSheetFromCloud, DatabaseSheetEntry, fetchTemplates, saveTemplate, deleteTemplateFromCloud, fetchGlobalSettings, saveGlobalSettings } from './services/databaseService';

const DEFAULT_GST = 0.05;
const FIXED_PST = 0.07;
const DEFAULT_TERMS_EN = "Prices are subject to change without further notice.";
const DEFAULT_TERMS_ZH = "價格如有變更，恕不另行通知。";

const DEFAULT_BUSINESS_INFO: BusinessInfo = {
  name: "Victory Memorial Park",
  address: "14831 28th Ave, Surrey, BC, V4P 1P3",
  email: "wells.wang@dignitymemorial.com",
  phone: "778-866-8863"
};

const STORAGE_KEYS = {
  SOURCES: 'quote_gen_sources',
  CATALOG: 'quote_gen_catalog',
  BUSINESS: 'quote_gen_business_v2'
};

const createInitialProcessingFee = (): QuoteLineItem => ({
  id: `fee-initial-${Date.now()}`,
  productId: 'PROC-FEE',
  name: 'Processing Fee',
  chineseName: '手續費',
  quantity: 1,
  unitPrice: 50,
  total: 50,
  section: 'Merchandise and Services',
  isGSTApplicable: true,
  isPSTApplicable: false,
  isDiscountable: false
});

declare var html2pdf: any;

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<'builder' | 'history' | 'sheets' | 'compare'>('builder');
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768);
  const [mobileCompareOption, setMobileCompareOption] = useState<'all' | number>('all');
  const [reviewModeView, setReviewModeView] = useState<'mobile' | 'a4'>('mobile');
  const [mobileReviewSectionFilter, setMobileReviewSectionFilter] = useState<'all' | 'Property' | 'Merchandise and Services'>('all');
  const [isMobileTermsOpen, setIsMobileTermsOpen] = useState(false);
  const [quoteFontSize, setQuoteFontSize] = useState<'standard' | 'medium' | 'large'>('standard');
  const [isDepositManual, setIsDepositManual] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  
  const quoteRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const uploadSectionRef = useRef<ItemSection>('Property');

  const [isResizing, setIsResizing] = useState(false);
  const [startY, setStartY] = useState(0);
  const [startHeight, setStartHeight] = useState(350);

  const [dbSheets, setDbSheets] = useState<DatabaseSheetEntry[]>([]);
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [comparisonQuotes, setComparisonQuotes] = useState<Quote[]>([]);
  const [isComparisonReviewMode, setIsComparisonReviewMode] = useState(false);
  const [showCompareDetails, setShowCompareDetails] = useState(false);
  const [comparisonScale, setComparisonScale] = useState<'auto' | 'standard' | 'compact'>('auto');
  const [compareImgHeight, setCompareImgHeight] = useState<number>(130);

  const maxCompareItems = Math.max(...comparisonQuotes.map(q => q.items.length), 0);
  const hasCompareImages = comparisonQuotes.some(q => !!q.imageUrl);
  const isDenseCompare = comparisonScale === 'compact' || (comparisonScale === 'auto' && (maxCompareItems > 3 || (maxCompareItems > 1 && hasCompareImages) || comparisonQuotes.length >= 3));

  // Sort items following the print quote ordering: Property items first, then Merchandise and Services items
  const getPrintOrderedItems = (items: QuoteLineItem[]): QuoteLineItem[] => {
    if (!items || items.length === 0) return [];
    const propertyItems = items.filter(i => i.section === 'Property');
    const msItems = items.filter(i => i.section === 'Merchandise and Services');
    const otherItems = items.filter(i => i.section !== 'Property' && i.section !== 'Merchandise and Services');
    return [...propertyItems, ...msItems, ...otherItems];
  };

  const getQuotePercentDiscountSavings = (q: Quote) => {
    if (!q.discountPercent) return 0;
    const waivedItemsTotal = q.items.filter(i => i.isWaived).reduce((sum, i) => sum + i.total, 0);
    const manualDiscountInput = q.manualDiscountAmount || 0;
    const effectiveWaiveTotal = waivedItemsTotal > 0 ? waivedItemsTotal : manualDiscountInput;
    let unallocatedWaive = effectiveWaiveTotal;

    let totalDiscBase = 0;
    q.items.forEach(i => {
      let discountableRatio = 0;
      if (i.isDiscountable) {
        discountableRatio = (i.section === 'Property' && i.isECFIncluded) ? 0.9 : 1.0;
      }
      const grossDiscountable = i.total * discountableRatio;
      let waivedDiscountable = 0;
      if (i.isWaived) {
        waivedDiscountable = grossDiscountable;
      } else if (waivedItemsTotal === 0 && unallocatedWaive > 0) {
        waivedDiscountable = Math.min(grossDiscountable, unallocatedWaive);
        unallocatedWaive -= waivedDiscountable;
      }
      const remDisc = Math.max(0, grossDiscountable - waivedDiscountable);
      if (!i.isWaived) {
        totalDiscBase += remDisc;
      }
    });
    return totalDiscBase * (q.discountPercent / 100);
  };

  // PERSISTENT USER-SPECIFIC BUSINESS INFO (Device bound)
  const [businessProfile, setBusinessProfile] = useState<BusinessInfo>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.BUSINESS);
    return saved ? JSON.parse(saved) : DEFAULT_BUSINESS_INFO;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.BUSINESS, JSON.stringify(businessProfile));
  }, [businessProfile]);

  const [catalog, setCatalog] = useState<PricingItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CATALOG);
    return (saved && JSON.parse(saved).length > 0) ? JSON.parse(saved) : [];
  });

  const [sources, setSources] = useState<SheetSource[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SOURCES);
    return (saved && JSON.parse(saved).length > 0) ? JSON.parse(saved) : [];
  });
  
  const [selectedSection, setSelectedSection] = useState<ItemSection>('Property');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('');
  const [itemSearch, setItemSearch] = useState<string>('');

  const [customName, setCustomName] = useState('');
  const [customChineseName, setCustomChineseName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customSection, setCustomSection] = useState<ItemSection>('Merchandise and Services');
  const [showEcfPrompt, setShowEcfPrompt] = useState(false);
  const [pendingCustomItem, setPendingCustomItem] = useState<{ name: string; chineseName: string; price: number; section: ItemSection } | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(sources));
  }, [sources]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CATALOG, JSON.stringify(catalog));
  }, [catalog]);

  const loadCloudDatabase = async () => {
    setIsLoadingDb(true);
    try {
      const sheets = await fetchDatabaseSheets();
      setDbSheets(sheets);
      setDbConnected(true);
      return sheets;
    } catch (err) { 
      console.error("Cloud Load Error:", err); 
      setDbConnected(false);
      return [];
    } finally { 
      setIsLoadingDb(false); 
    }
  };

  const processSheetData = (dbSheet: DatabaseSheetEntry, syncedConfig?: any) => {
    const headers = getHeaders(dbSheet.csvData);
    const source: SheetSource = {
      id: dbSheet.id,
      name: syncedConfig?.name || dbSheet.name,
      lastSync: new Date().toISOString(),
      isLocal: false,
      origin: 'database',
      section: dbSheet.section,
      headers: headers,
      rawCsvData: dbSheet.csvData,
      descriptionColumn: syncedConfig?.descriptionColumn || headers[0],
      chineseDescriptionColumn: syncedConfig?.chineseDescriptionColumn || headers.find(h => h.includes('中') || h.toUpperCase().includes('CHINESE')) || 'none',
      priceColumn: syncedConfig?.priceColumn || headers.find(h => h.toUpperCase().includes('PRICE')) || headers[1] || '',
      subcategoryColumn: syncedConfig?.subcategoryColumn || 'none',
      ecfPriceColumn: syncedConfig?.ecfPriceColumn,
      isECFIncluded: syncedConfig?.isECFIncluded !== undefined ? syncedConfig.isECFIncluded : true,
      extraMappings: syncedConfig?.extraMappings || []
    };
    
    const items = parseCSV(
      dbSheet.csvData, 
      source.name, 
      dbSheet.id, 
      dbSheet.section, 
      source.descriptionColumn, 
      source.priceColumn, 
      source.subcategoryColumn, 
      source.ecfPriceColumn, 
      source.extraMappings, 
      source.chineseDescriptionColumn !== 'none' ? source.chineseDescriptionColumn : undefined
    );
    
    return { source, items };
  };

  const handleConnectDatabaseSheet = (dbSheet: DatabaseSheetEntry, syncedConfig?: any) => {
    const { source, items } = processSheetData(dbSheet, syncedConfig);
    
    setSources(prev => {
      if (prev.some(s => s.id === dbSheet.id)) {
        return prev.map(s => s.id === dbSheet.id ? source : s);
      }
      return [...prev, source];
    });
    
    setCatalog(prev => [...prev.filter(item => item.sourceId !== dbSheet.id), ...items]);
  };

  const loadTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const data = await fetchTemplates();
      setTemplates(data);
      setDbConnected(true);
    } catch (err) { 
      console.error("Templates Load Error:", err); 
      setDbConnected(false);
    } finally { 
      setIsLoadingTemplates(false); 
    }
  };

  const syncGlobalSettings = async () => {
    try {
      const cloudSettings = await fetchGlobalSettings();
      if (cloudSettings) {
        if (cloudSettings.businessProfile) {
          setBusinessProfile(cloudSettings.businessProfile);
          localStorage.setItem(STORAGE_KEYS.BUSINESS, JSON.stringify(cloudSettings.businessProfile));
        }
        if (cloudSettings.workspaceConfig) {
          // Store workspace config in a ref or state to be used during sheet connection
          return cloudSettings.workspaceConfig;
        }
      }
    } catch (err) {
      console.error("Sync Settings Error:", err);
    }
    return null;
  };

  const handleSaveWorkspaceConfig = async () => {
    setIsSyncing(true);
    try {
      // We only save the configuration (mappings), not the raw data
      const workspaceConfig = sources.map(s => ({
        id: s.id,
        name: s.name,
        descriptionColumn: s.descriptionColumn,
        chineseDescriptionColumn: s.chineseDescriptionColumn,
        priceColumn: s.priceColumn,
        subcategoryColumn: s.subcategoryColumn,
        ecfPriceColumn: s.ecfPriceColumn,
        isECFIncluded: s.isECFIncluded,
        extraMappings: s.extraMappings
      }));
      
      await saveGlobalSettings({ 
        businessProfile, // Keep profile sync too as it's useful
        workspaceConfig 
      });
      alert("Workspace configuration saved to cloud for all devices.");
    } catch (err) {
      console.error("Save Workspace Error:", err);
      alert("Failed to save workspace configuration.");
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      const sheets = await loadCloudDatabase();
      loadTemplates();
      const cloudSettings = await fetchGlobalSettings();
      
      if (cloudSettings) {
        if (cloudSettings.businessProfile) {
          setBusinessProfile(cloudSettings.businessProfile);
          localStorage.setItem(STORAGE_KEYS.BUSINESS, JSON.stringify(cloudSettings.businessProfile));
        }
      }

      const cloudConfig = cloudSettings?.workspaceConfig;
      const savedSourcesRaw = localStorage.getItem(STORAGE_KEYS.SOURCES);
      const localSources = savedSourcesRaw ? JSON.parse(savedSourcesRaw).filter((s: any) => s.origin === 'local') : [];
      
      if (sheets && sheets.length > 0) {
        const newSources: SheetSource[] = [];
        const newCatalogItems: PricingItem[] = [];
        
        // 1. If we have a cloud config, it defines our primary workspace and order
        if (cloudConfig && Array.isArray(cloudConfig)) {
          cloudConfig.forEach((config: any) => {
            const sheet = sheets.find(s => s.id === config.id);
            if (sheet) {
              const { source, items } = processSheetData(sheet, config);
              newSources.push(source);
              newCatalogItems.push(...items);
            }
          });
        }
        
        // 2. Add any sheets that are in the database but NOT in the cloud config
        // (This handles newly added sheets that haven't been "preset" yet)
        sheets.forEach(sheet => {
          if (!newSources.some(s => s.id === sheet.id)) {
            // If the user has NO local sources yet, we add everything from DB
            // If they DO have local sources, we only add if it's not already there
            if (!savedSourcesRaw || !cloudConfig) {
               const { source, items } = processSheetData(sheet);
               newSources.push(source);
               newCatalogItems.push(...items);
            }
          }
        });
        
        // 3. Add local sources back
        localSources.forEach((ls: any) => {
          newSources.push(ls);
          const items = parseCSV(ls.rawCsvData, ls.name, ls.id, ls.section, ls.descriptionColumn, ls.priceColumn, ls.subcategoryColumn, ls.ecfPriceColumn, ls.extraMappings, ls.chineseDescriptionColumn !== 'none' ? ls.chineseDescriptionColumn : undefined);
          newCatalogItems.push(...items);
        });
        
        setSources(newSources);
        setCatalog(newCatalogItems);
      }
    };
    bootstrap();
  }, []);

  const availableSources = useMemo(() => sources.filter(s => s.section === selectedSection), [sources, selectedSection]);
  
  const availableSubcategories = useMemo(() => {
    if (!selectedSourceId) return [];
    const itemsForSource = catalog.filter(i => i.sourceId === selectedSourceId);
    return Array.from(new Set(itemsForSource.map(i => i.category))).filter(Boolean).sort();
  }, [catalog, selectedSourceId]);

  const filteredItems = useMemo(() => {
    return catalog.filter(item => {
      const matchSection = item.section === selectedSection;
      const matchSource = !selectedSourceId || item.sourceId === selectedSourceId;
      const matchSubcat = !selectedSubcategory || item.category === selectedSubcategory;
      const matchSearch = !itemSearch || item.name.toLowerCase().includes(itemSearch.toLowerCase());
      return matchSection && matchSource && matchSubcat && matchSearch;
    });
  }, [catalog, selectedSection, selectedSourceId, selectedSubcategory, itemSearch]);

  const [currentQuote, setCurrentQuote] = useState<Quote>(() => ({
    id: `QT-${Date.now()}`,
    clientName: '',
    date: new Date().toLocaleDateString(),
    items: [createInitialProcessingFee()],
    subtotal: 0,
    discountPercent: 0,
    manualDiscountAmount: 0,
    manualDiscountName: 'Miscellaneous Waived',
    gstRate: DEFAULT_GST,
    pstRate: FIXED_PST,
    gstTotal: 0,
    pstTotal: 0,
    grandTotal: 0,
    status: 'draft',
    terms: DEFAULT_TERMS_EN,
    businessInfo: businessProfile, 
    isMonthlyPaymentEnabled: false,
    depositAmount: 0,
    interestRate: 0,
    paymentMonths: 60,
    isChineseEnabled: false
  }));

  // Automatic branding sync
  useEffect(() => {
    setCurrentQuote(prev => ({ ...prev, businessInfo: businessProfile }));
  }, [businessProfile]);

  useEffect(() => {
    const rawSubtotal = currentQuote.items.reduce((sum, item) => sum + item.total, 0);
    const waivedItemsTotal = currentQuote.items.filter(i => i.isWaived).reduce((sum, i) => sum + i.total, 0);
    const manualDiscountInput = currentQuote.manualDiscountAmount || 0;
    
    // Effective waive total is either sum of explicitly waived items or manually entered global waive
    const effectiveWaiveTotal = waivedItemsTotal > 0 ? waivedItemsTotal : manualDiscountInput;
    const percMult = 1 - (currentQuote.discountPercent / 100);

    let unallocatedWaive = effectiveWaiveTotal;

    // First pass: calculate gross discountable and non-discountable for each item,
    // and allocate explicitly waived items or unallocated waiver against discountable portions first.
    const itemPrep = currentQuote.items.map(i => {
      let discountableRatio = 0;
      if (i.isDiscountable) {
        if (i.section === 'Property' && i.isECFIncluded) {
          discountableRatio = 0.9;
        } else {
          discountableRatio = 1.0;
        }
      }

      const grossDiscountable = i.total * discountableRatio;
      const grossNonDiscountable = i.total * (1 - discountableRatio);

      let waivedDiscountable = 0;
      let waivedNonDiscountable = 0;

      if (i.isWaived) {
        waivedDiscountable = grossDiscountable;
        waivedNonDiscountable = grossNonDiscountable;
      } else if (waivedItemsTotal === 0 && unallocatedWaive > 0) {
        waivedDiscountable = Math.min(grossDiscountable, unallocatedWaive);
        unallocatedWaive -= waivedDiscountable;
      }

      return {
        item: i,
        grossDiscountable,
        grossNonDiscountable,
        waivedDiscountable,
        waivedNonDiscountable
      };
    });

    // Second pass: if any unallocated dollar waiver remains after exhausting all discountable portions,
    // allocate it against non-discountable portions.
    const itemCalc = itemPrep.map(prep => {
      let waivedNonDisc = prep.waivedNonDiscountable;
      if (!prep.item.isWaived && waivedItemsTotal === 0 && unallocatedWaive > 0) {
        const addWaive = Math.min(prep.grossNonDiscountable, unallocatedWaive);
        waivedNonDisc += addWaive;
        unallocatedWaive -= addWaive;
      }

      const remainingDiscountable = Math.max(0, prep.grossDiscountable - prep.waivedDiscountable);
      const remainingNonDiscountable = Math.max(0, prep.grossNonDiscountable - waivedNonDisc);

      const netAfterDisc = prep.item.isWaived 
        ? 0 
        : (remainingDiscountable * percMult) + remainingNonDiscountable;

      return {
        ...prep,
        waivedNonDiscountable: waivedNonDisc,
        remainingDiscountable,
        remainingNonDiscountable,
        netAfterDisc
      };
    });

    const totalNetSubtotal = itemCalc.reduce((sum, c) => sum + c.netAfterDisc, 0);
    const gstTotal = itemCalc
      .filter(c => c.item.isGSTApplicable)
      .reduce((sum, c) => sum + (c.netAfterDisc * currentQuote.gstRate), 0);
    const pstTotal = itemCalc
      .filter(c => c.item.isPSTApplicable)
      .reduce((sum, c) => sum + (c.netAfterDisc * FIXED_PST), 0);

    const grandTotal = Math.round((totalNetSubtotal + gstTotal + pstTotal) * 100) / 100;
    
    setCurrentQuote(prev => {
      const syncWaiveAmount = waivedItemsTotal > 0 ? waivedItemsTotal : prev.manualDiscountAmount;
      const minDeposit = grandTotal * 0.1;
      // Round UP to the nearest 100 for the default
      const defaultDeposit = Math.ceil(minDeposit / 100) * 100;
      
      // Removed hard Math.max limit on the depositAmount to follow "Don't put a hard limit on the input"
      let actualDeposit = isDepositManual ? prev.depositAmount : defaultDeposit;
      
      const financeAmount = Math.max(0, grandTotal - actualDeposit);
      let monthly = 0;
      if (prev.isMonthlyPaymentEnabled && prev.paymentMonths > 0) {
        if (prev.interestRate > 0) {
          const r = prev.interestRate / 100 / 12;
          monthly = (financeAmount * r * Math.pow(1 + r, prev.paymentMonths)) / (Math.pow(1 + r, prev.paymentMonths) - 1);
        } else {
          monthly = financeAmount / prev.paymentMonths;
        }
      }
      
      // Only trigger state update if values actually changed to avoid cycles
      if (
        prev.subtotal === rawSubtotal &&
        prev.manualDiscountAmount === syncWaiveAmount &&
        prev.gstTotal === gstTotal &&
        prev.pstTotal === pstTotal &&
        prev.grandTotal === grandTotal &&
        prev.depositAmount === actualDeposit &&
        prev.monthlyPaymentAmount === monthly
      ) {
        return prev;
      }

      return { 
        ...prev, 
        subtotal: rawSubtotal, 
        manualDiscountAmount: syncWaiveAmount,
        gstTotal, 
        pstTotal, 
        grandTotal, 
        depositAmount: actualDeposit, 
        monthlyPaymentAmount: monthly 
      };
    });
  }, [
    currentQuote.items, 
    currentQuote.discountPercent, 
    currentQuote.manualDiscountAmount, 
    currentQuote.gstRate, 
    currentQuote.isMonthlyPaymentEnabled, 
    currentQuote.paymentMonths, 
    currentQuote.interestRate, 
    isDepositManual,
    currentQuote.depositAmount
  ]);

  const handleNewQuote = () => {
    if (!confirm(currentQuote.isChineseEnabled ? "確定要開始新的報價嗎？" : "Are you sure you want to start a new quote?")) return;
    setCurrentQuote({
      id: `QT-${Date.now()}`,
      clientName: '',
      date: new Date().toLocaleDateString(),
      items: [createInitialProcessingFee()],
      subtotal: 0,
      discountPercent: 0,
      manualDiscountAmount: 0,
      manualDiscountName: 'Miscellaneous Waived',
      gstRate: DEFAULT_GST,
      pstRate: FIXED_PST,
      gstTotal: 0,
      pstTotal: 0,
      grandTotal: 0,
      status: 'draft',
      terms: currentQuote.isChineseEnabled ? DEFAULT_TERMS_ZH : DEFAULT_TERMS_EN,
      businessInfo: businessProfile,
      isMonthlyPaymentEnabled: false,
      depositAmount: 0,
      interestRate: 0,
      paymentMonths: 60,
      isChineseEnabled: currentQuote.isChineseEnabled,
      imageUrl: undefined
    });
    setIsDepositManual(false);
  };

  const handleToggleChinese = (enabled: boolean) => {
    setCurrentQuote(p => {
      let nextTerms = p.terms;
      if (enabled && (p.terms === DEFAULT_TERMS_EN || !p.terms.trim())) {
        nextTerms = DEFAULT_TERMS_ZH;
      } else if (!enabled && (p.terms === DEFAULT_TERMS_ZH || !p.terms.trim())) {
        nextTerms = DEFAULT_TERMS_EN;
      }
      return { ...p, isChineseEnabled: enabled, terms: nextTerms };
    });
  };

  const handleLoadTemplate = (t: QuoteTemplate) => {
    if (!confirm(`Load template "${t.template_name}"?`)) return;
    const quoteWithCurrentProfile: Quote = { 
      ...t, 
      id: `QT-${Date.now()}`, 
      date: new Date().toLocaleDateString(), 
      status: 'draft',
      isChineseEnabled: !!t.isChineseEnabled,
      businessInfo: businessProfile 
    };
    setCurrentQuote(quoteWithCurrentProfile);
    setIsDepositManual(true); 
    setActiveView('builder');
  };

  const handleAddCustomItem = () => {
    if (!customName.trim()) return;
    const p = parseFloat(customPrice) || 0;
    
    if (customSection === 'Property') {
      setPendingCustomItem({
        name: customName,
        chineseName: customChineseName || customName,
        price: p,
        section: customSection
      });
      setShowEcfPrompt(true);
      return;
    }

    const newItem: QuoteLineItem = { 
      id: `custom-${Date.now()}`, 
      productId: 'CUSTOM', 
      name: customName, 
      chineseName: customChineseName || customName, 
      quantity: 1, 
      unitPrice: p, 
      total: p, 
      section: customSection, 
      isGSTApplicable: true, 
      isPSTApplicable: false, 
      isDiscountable: true, 
      isECFIncluded: false 
    };
    setCurrentQuote(prev => ({ ...prev, items: [...prev.items, newItem] }));
    setCustomName(''); setCustomChineseName(''); setCustomPrice('');
  };

  const handleConfirmEcf = (isEcf: boolean) => {
    if (!pendingCustomItem) return;
    const newItem: QuoteLineItem = { 
      id: `custom-${Date.now()}`, 
      productId: 'CUSTOM', 
      name: pendingCustomItem.name, 
      chineseName: pendingCustomItem.chineseName, 
      quantity: 1, 
      unitPrice: pendingCustomItem.price, 
      total: pendingCustomItem.price, 
      section: pendingCustomItem.section, 
      isGSTApplicable: true, 
      isPSTApplicable: false, 
      isDiscountable: true, 
      isECFIncluded: isEcf 
    };
    setCurrentQuote(prev => ({ ...prev, items: [...prev.items, newItem] }));
    setCustomName(''); setCustomChineseName(''); setCustomPrice('');
    setPendingCustomItem(null);
    setShowEcfPrompt(false);
  };

  const addItemToQuote = (p: PricingItem) => {
    const t = Date.now();
    const source = sources.find(s => s.id === p.sourceId);
    const mainItem: QuoteLineItem = {
      id: `line-${t}`, productId: p.sku, name: p.name, chineseName: p.chineseName || p.name, quantity: 1, unitPrice: p.price, total: p.price, section: p.section, isGSTApplicable: true, isPSTApplicable: false, isDiscountable: !p.name.toLowerCase().includes('processing fee'), isECFIncluded: source?.isECFIncluded
    };
    const lines = [mainItem];
    if (source?.section === 'Property' && !source.isECFIncluded && p.ecfPrice && p.ecfPrice > 0) {
      lines.push({ id: `ecf-${t}`, productId: `${p.sku}-ECF`, name: `ECF - ${p.name}`, chineseName: `管理基金 - ${p.chineseName || p.name}`, quantity: 1, unitPrice: p.ecfPrice, total: p.ecfPrice, section: 'Property', isGSTApplicable: true, isPSTApplicable: false, isDiscountable: false });
    }
    if (p.extraPrices) {
      p.extraPrices.forEach((ep, idx) => {
        lines.push({ id: `ext-${t}-${idx}`, productId: `${p.sku}-EXT`, name: ep.name, chineseName: ep.chineseName || ep.name, quantity: 1, unitPrice: ep.price, total: ep.price, section: p.section, isGSTApplicable: true, isPSTApplicable: false, isDiscountable: false });
      });
    }
    setCurrentQuote(prev => ({ ...prev, items: [...prev.items, ...lines] }));
  };

  const handleMoveSource = (id: string, direction: 'up' | 'down') => {
    setSources(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      const newSources = [...prev];
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= newSources.length) return prev;
      [newSources[idx], newSources[targetIdx]] = [newSources[targetIdx], newSources[idx]];
      return newSources;
    });
  };

  const handleUpdateMapping = (sourceId: string, desc: string, price: string, sub: string, ecf?: string, inc?: boolean, extras?: ExtraPricingMapping[], chineseDesc?: string) => {
    setIsSyncing(true);
    setSources(prev => prev.map(s => {
      if (s.id === sourceId && s.rawCsvData) {
        const newData = parseCSV(s.rawCsvData, s.name, s.id, s.section, desc, price, sub, ecf, extras, chineseDesc !== 'none' ? chineseDesc : undefined);
        setCatalog(old => [...old.filter(item => item.sourceId !== sourceId), ...newData]);
        return { ...s, descriptionColumn: desc, priceColumn: price, subcategoryColumn: sub, ecfPriceColumn: ecf, isECFIncluded: inc, extraMappings: extras, chineseDescriptionColumn: chineseDesc };
      }
      return s;
    }));
    setTimeout(() => setIsSyncing(false), 300);
  };

  const handleSaveAsTemplate = async () => {
    const tName = prompt("Enter a unique name for this template:");
    if (!tName) return;
    setIsSyncing(true);
    try {
      await saveTemplate({ ...currentQuote, template_name: tName });
      alert("Successfully saved template to Supabase cloud!"); 
      loadTemplates();
    } catch (err: any) { alert(`ERROR SAVING TEMPLATE: ${err.message}`); } finally { setIsSyncing(false); }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsSyncing(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const id = `local-${Date.now()}`;
      const headers = getHeaders(text);
      const newSource: SheetSource = {
        id, name: file.name.replace('.csv', ''), fileName: file.name, lastSync: new Date().toISOString(), isLocal: true, origin: 'local', section: uploadSectionRef.current, headers, rawCsvData: text, descriptionColumn: headers[0], priceColumn: headers.find(h => h.toUpperCase().includes('PRICE')) || headers[1] || '', subcategoryColumn: 'none', isECFIncluded: true, chineseDescriptionColumn: 'none'
      };
      setSources(prev => [...prev, newSource]);
      const data = parseCSV(text, newSource.name, id, uploadSectionRef.current, newSource.descriptionColumn, newSource.priceColumn);
      setCatalog(prev => [...prev, ...data]);
      setIsSyncing(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const onImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setCurrentQuote(prev => ({ ...prev, imageUrl: dataUrl, imageHeight: 350 }));
    };
    reader.readAsDataURL(file);
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    setStartY(clientY);
    setStartHeight(currentQuote.imageHeight || 350);
  };

  useEffect(() => {
    const handleResizeMove = (e: MouseEvent | TouchEvent) => {
      if (!isResizing) return;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      const delta = clientY - startY;
      const newHeight = Math.max(50, Math.min(800, startHeight + delta));
      setCurrentQuote(prev => ({ ...prev, imageHeight: newHeight }));
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      window.addEventListener('touchmove', handleResizeMove);
      window.addEventListener('touchend', handleResizeEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
      window.removeEventListener('touchmove', handleResizeMove);
      window.removeEventListener('touchend', handleResizeEnd);
    };
  }, [isResizing, startY, startHeight]);

  const handleSavePDF = (autoTriggerPrint: boolean = false) => {
    if (reviewModeView !== 'a4') {
      setReviewModeView('a4');
    }
    setIsGeneratingPDF(true);
    setTimeout(() => {
      const element = quoteRef.current;
      if (!element) {
        setIsGeneratingPDF(false);
        if (autoTriggerPrint) window.print();
        return;
      }
      const filename = `Quote-${currentQuote.clientName || 'Customer'}-${currentQuote.id.split('-').pop()}.pdf`;
      const opt = { 
        margin: 0, 
        filename: filename, 
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { scale: 2, useCORS: true, letterRendering: true, scrollY: 0, scrollX: 0 }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, 
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] } 
      };
      if (typeof html2pdf !== 'undefined') {
        html2pdf().set(opt).from(element).save()
          .then(() => setIsGeneratingPDF(false))
          .catch((err: any) => {
            console.warn("html2pdf export failed, fallback to print dialog", err);
            setIsGeneratingPDF(false);
            if (autoTriggerPrint) window.print();
          });
      } else {
        setIsGeneratingPDF(false);
        if (autoTriggerPrint) window.print();
      }
    }, 350);
  };

  const handleOpenReview = () => {
    // Default to the viewing list preview screen on mobile, iPad, and desktop webpage
    setReviewModeView('mobile');
    setIsReviewMode(true);
  };

  if (isReviewMode) {
    const propertyItems = currentQuote.items.filter(i => i.section === 'Property');
    const msItems = currentQuote.items.filter(i => i.section === 'Merchandise and Services');
    
    // Adaptive spacing and page calculations to strictly enforce neat single-page fits
    const totalItems = propertyItems.length + msItems.length;
    const hasImage = !!currentQuote.imageUrl;
    const isDense = totalItems > 5 || (totalItems > 3 && hasImage);

    // Adaptive font scaling based on content density to fit 1 page elegantly
    const textBase = {
      standard: isDense ? 'text-[11px] leading-tight py-0.5' : 'text-xs py-1.5',
      medium: isDense ? 'text-xs py-1' : 'text-sm py-1.5',
      large: isDense ? 'text-sm py-1' : 'text-base py-2'
    }[quoteFontSize];

    const getAdaptiveImageHeight = () => {
      if (!currentQuote.imageUrl) return 0;
      const baseHeight = currentQuote.imageHeight || 350;
      if (totalItems > 6) return Math.min(baseHeight, 150);
      if (totalItems > 4) return Math.min(baseHeight, 220);
      return baseHeight;
    };

    const containerPaddingClass = isDense 
      ? (isGeneratingPDF ? 'p-[6mm]' : 'p-[12mm]') 
      : (isGeneratingPDF ? 'p-[12mm]' : 'p-[20mm]');

    const manualWaiveValue = Math.min(currentQuote.subtotal, currentQuote.manualDiscountAmount || 0);
    const subtotalAfterManual = currentQuote.subtotal - manualWaiveValue;
    const actualSubtotalPreTax = currentQuote.grandTotal - currentQuote.gstTotal - currentQuote.pstTotal;
    const effectivePercentSavings = Math.max(0, subtotalAfterManual - actualSubtotalPreTax);

    const filteredMobileItems = mobileReviewSectionFilter === 'Property'
      ? propertyItems
      : mobileReviewSectionFilter === 'Merchandise and Services'
      ? msItems
      : currentQuote.items;

    return (
      <div className="min-h-screen bg-slate-50 print:bg-white overflow-y-auto">
        {/* Review Header & Navigation Bar */}
        <div className="bg-white/95 backdrop-blur-md shadow-xs border-b border-slate-200 p-3 sm:px-6 flex flex-wrap justify-between items-center print:hidden sticky top-0 z-50 gap-2">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsReviewMode(false)} 
              className="px-3 md:px-4 py-2 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition-all flex items-center gap-1.5 text-xs md:text-sm active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"/></svg>
              <span>{currentQuote.isChineseEnabled ? '返回編輯' : 'Back to Editor'}</span>
            </button>

            {/* Segmented View Switcher: Viewing List vs A4 Document */}
            <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200">
              <button 
                onClick={() => setReviewModeView('mobile')} 
                className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all flex items-center gap-1.5 ${reviewModeView === 'mobile' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
                <span>{currentQuote.isChineseEnabled ? '檢視列表' : 'Viewing List'}</span>
              </button>
              <button 
                onClick={() => setReviewModeView('a4')} 
                className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all flex items-center gap-1.5 ${reviewModeView === 'a4' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                <span>{currentQuote.isChineseEnabled ? 'A4 頁面' : 'A4 Sheet'}</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {reviewModeView === 'a4' && (
              <div className="flex items-center gap-1.5 mr-1 md:mr-2 border-r pr-2 md:pr-4">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{currentQuote.isChineseEnabled ? '字體' : 'Font'}:</span>
                <select value={quoteFontSize} onChange={(e) => setQuoteFontSize(e.target.value as any)} className="text-xs font-bold bg-slate-100 border-none rounded-lg px-2 py-1">
                  <option value="standard">Standard</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
            )}

            {reviewModeView === 'a4' && (
              <button 
                onClick={() => window.print()}
                className="px-3 md:px-4 py-2 bg-slate-900 text-white font-bold text-xs md:text-sm rounded-xl shadow-md flex items-center gap-1.5 hover:bg-slate-800 transition-all active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                <span>{currentQuote.isChineseEnabled ? "列印" : "Print"}</span>
              </button>
            )}

            <button 
              onClick={() => handleSavePDF(true)} 
              disabled={isGeneratingPDF}
              className={`px-4 md:px-6 py-2 bg-blue-600 text-white font-black text-xs md:text-sm rounded-xl shadow-lg shadow-blue-500/20 flex items-center gap-1.5 hover:bg-blue-700 transition-all active:scale-95 ${isGeneratingPDF ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              <span>{isGeneratingPDF ? (currentQuote.isChineseEnabled ? "生成中..." : "Generating...") : (currentQuote.isChineseEnabled ? "保存為 PDF" : "Save as PDF")}</span>
            </button>
          </div>
        </div>

        {/* View 1: Responsive Unified Statement Preview Screen (Mobile, iPad & Desktop) */}
        {reviewModeView === 'mobile' ? (
          <div className="p-3 sm:p-6 md:p-8 lg:p-10 max-w-5xl xl:max-w-6xl mx-auto w-full pb-32 md:pb-24 animate-in fade-in">
            {/* Single elegant cohesive quote statement card */}
            <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-5 sm:p-8 md:p-10 space-y-6 md:space-y-8">
              
              {/* Document Header */}
              <div className="space-y-5 border-b border-slate-100 pb-6">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
                      <h2 className="text-sm sm:text-base font-black tracking-widest uppercase text-slate-800">
                        {currentQuote.businessInfo.name || 'Wells Inc.'}
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 font-medium flex flex-wrap items-center gap-x-2">
                      {currentQuote.businessInfo.phone && <span>{currentQuote.businessInfo.phone}</span>}
                      {currentQuote.businessInfo.phone && currentQuote.businessInfo.email && <span className="text-slate-300">·</span>}
                      {currentQuote.businessInfo.email && <span>{currentQuote.businessInfo.email}</span>}
                      {currentQuote.businessInfo.address && <span className="text-slate-300 hidden sm:inline">·</span>}
                      {currentQuote.businessInfo.address && <span className="hidden sm:inline">{currentQuote.businessInfo.address}</span>}
                    </p>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {currentQuote.isChineseEnabled ? '報價編號' : 'Quote Ref'}:
                      </span>
                      <span className="text-xs md:text-sm font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                        #{currentQuote.id.split('-').pop()}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-medium mt-1">
                      {currentQuote.isChineseEnabled ? '日期' : 'Date'}: {currentQuote.date}
                    </span>
                  </div>
                </div>

                {/* Client & Big Hero Price */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-end justify-between gap-4 bg-slate-50/70 rounded-2xl p-4 sm:p-6 border border-slate-100">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      {currentQuote.isChineseEnabled ? '敬呈' : 'Prepared for'}
                    </span>
                    <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-0.5">
                      {currentQuote.clientName || (currentQuote.isChineseEnabled ? '尊貴客戶' : 'Valued Client')}
                    </h3>
                    {currentQuote.clientAddress && (
                      <p className="text-xs text-slate-500 mt-1">{currentQuote.clientAddress}</p>
                    )}
                    {currentQuote.clientPhone && (
                      <p className="text-xs text-slate-500">{currentQuote.clientPhone}</p>
                    )}
                  </div>
                  <div className="text-left sm:text-right pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/60">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      {currentQuote.isChineseEnabled ? '應付總額' : 'Total Due'}
                    </span>
                    <span className="text-2xl sm:text-3xl lg:text-4xl font-black text-blue-600 tracking-tight block">
                      ${currentQuote.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}
                    </span>
                  </div>
                </div>

                {/* Optional Payment Plan subtle banner */}
                {currentQuote.isMonthlyPaymentEnabled && (
                  <div className="bg-blue-50/50 border border-blue-100/80 rounded-xl p-3.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      <span className="font-bold text-slate-800 text-sm">
                        ${currentQuote.monthlyPaymentAmount?.toLocaleString(undefined, {minimumFractionDigits: 2})}
                      </span>
                      <span className="text-slate-500 font-normal"> / mo</span>
                      <span className="text-slate-400 mx-1">·</span>
                      <span className="text-slate-600 font-medium">
                        {currentQuote.paymentMonths} {currentQuote.isChineseEnabled ? '個月分期' : 'months'} ({currentQuote.interestRate}%)
                      </span>
                    </div>
                    <span className="text-xs text-slate-600">
                      {currentQuote.isChineseEnabled ? '首期訂金' : 'Deposit'}: <strong className="text-slate-800 font-bold">${currentQuote.depositAmount.toLocaleString()}</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Itemized Schedule - Clean unified list fitting Mobile, iPad & Desktop */}
              <div className="space-y-8">
                {/* Property Items Section */}
                {propertyItems.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-200">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        {currentQuote.isChineseEnabled ? '墓地物業 Property' : 'Property'}
                      </span>
                      <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        {propertyItems.length} {propertyItems.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>

                    {/* Column Headers for iPad & Desktop */}
                    <div className="hidden md:grid grid-cols-12 gap-3 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <div className="col-span-6">{currentQuote.isChineseEnabled ? '項目說明' : 'Item Description'}</div>
                      <div className="col-span-2 text-center">{currentQuote.isChineseEnabled ? '數量' : 'Quantity'}</div>
                      <div className="col-span-2 text-right">{currentQuote.isChineseEnabled ? '單價' : 'Unit Price'}</div>
                      <div className="col-span-2 text-right">{currentQuote.isChineseEnabled ? '金額' : 'Total'}</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {propertyItems.map((item) => (
                        <div key={item.id}>
                          {/* Mobile Row */}
                          <div className="py-2.5 flex justify-between items-start gap-3 md:hidden">
                            <div className="flex-1 pr-2">
                              <p className="text-xs font-bold text-slate-800 leading-snug">
                                {item.name}
                              </p>
                              {currentQuote.isChineseEnabled && item.chineseName && item.chineseName !== item.name && (
                                <p className="text-[11px] text-slate-500 mt-0.5">{item.chineseName}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 flex-wrap">
                                <span>{item.quantity} × ${item.unitPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                {item.isWaived && (
                                  <span className="font-bold text-rose-500 uppercase tracking-wider">
                                    {currentQuote.isChineseEnabled ? '已免除' : 'Waived'}
                                  </span>
                                )}
                                {item.isECFIncluded && (
                                  <span className="text-amber-700 bg-amber-50 px-1 py-0.2 rounded font-medium">ECF</span>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`text-xs font-bold ${item.isWaived ? 'line-through text-slate-300' : 'text-slate-800'}`}>
                                ${item.total.toLocaleString(undefined, {minimumFractionDigits: 2})}
                              </span>
                            </div>
                          </div>

                          {/* iPad & Desktop Row */}
                          <div className="hidden md:grid grid-cols-12 gap-3 items-center py-3.5 px-3 rounded-xl hover:bg-slate-50/70 transition-colors">
                            <div className="col-span-6 pr-4">
                              <p className="text-sm font-bold text-slate-800">
                                {item.name}
                              </p>
                              {currentQuote.isChineseEnabled && item.chineseName && item.chineseName !== item.name && (
                                <p className="text-xs text-slate-500 mt-0.5">{item.chineseName}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                {item.isWaived && (
                                  <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                    {currentQuote.isChineseEnabled ? '已免除費用' : 'Waived'}
                                  </span>
                                )}
                                {item.isECFIncluded && (
                                  <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200/60 px-1.5 py-0.5 rounded-md font-medium">ECF Included</span>
                                )}
                              </div>
                            </div>
                            <div className="col-span-2 text-center">
                              <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                                {item.quantity}
                              </span>
                            </div>
                            <div className="col-span-2 text-right">
                              <span className="text-xs font-medium text-slate-600">
                                ${item.unitPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}
                              </span>
                            </div>
                            <div className="col-span-2 text-right">
                              <span className={`text-sm font-black ${item.isWaived ? 'line-through text-slate-300' : 'text-slate-900'}`}>
                                ${item.total.toLocaleString(undefined, {minimumFractionDigits: 2})}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Merchandise & Services Section */}
                {msItems.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-200">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        {currentQuote.isChineseEnabled ? '商品及服務 Merchandise & Services' : 'Merchandise & Services'}
                      </span>
                      <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        {msItems.length} {msItems.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>

                    {/* Column Headers for iPad & Desktop */}
                    <div className="hidden md:grid grid-cols-12 gap-3 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <div className="col-span-6">{currentQuote.isChineseEnabled ? '項目說明' : 'Item Description'}</div>
                      <div className="col-span-2 text-center">{currentQuote.isChineseEnabled ? '數量' : 'Quantity'}</div>
                      <div className="col-span-2 text-right">{currentQuote.isChineseEnabled ? '單價' : 'Unit Price'}</div>
                      <div className="col-span-2 text-right">{currentQuote.isChineseEnabled ? '金額' : 'Total'}</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {msItems.map((item) => (
                        <div key={item.id}>
                          {/* Mobile Row */}
                          <div className="py-2.5 flex justify-between items-start gap-3 md:hidden">
                            <div className="flex-1 pr-2">
                              <p className="text-xs font-bold text-slate-800 leading-snug">
                                {item.name}
                              </p>
                              {currentQuote.isChineseEnabled && item.chineseName && item.chineseName !== item.name && (
                                <p className="text-[11px] text-slate-500 mt-0.5">{item.chineseName}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 flex-wrap">
                                <span>{item.quantity} × ${item.unitPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                {item.isWaived && (
                                  <span className="font-bold text-rose-500 uppercase tracking-wider">
                                    {currentQuote.isChineseEnabled ? '已免除' : 'Waived'}
                                  </span>
                                )}
                                {(item.isGSTApplicable || item.isPSTApplicable) && (
                                  <span className="bg-slate-100 text-slate-500 px-1 rounded">{item.isGSTApplicable && 'GST'}{item.isGSTApplicable && item.isPSTApplicable && '/'}{item.isPSTApplicable && 'PST'}</span>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`text-xs font-bold ${item.isWaived ? 'line-through text-slate-300' : 'text-slate-800'}`}>
                                ${item.total.toLocaleString(undefined, {minimumFractionDigits: 2})}
                              </span>
                            </div>
                          </div>

                          {/* iPad & Desktop Row */}
                          <div className="hidden md:grid grid-cols-12 gap-3 items-center py-3.5 px-3 rounded-xl hover:bg-slate-50/70 transition-colors">
                            <div className="col-span-6 pr-4">
                              <p className="text-sm font-bold text-slate-800">
                                {item.name}
                              </p>
                              {currentQuote.isChineseEnabled && item.chineseName && item.chineseName !== item.name && (
                                <p className="text-xs text-slate-500 mt-0.5">{item.chineseName}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                {item.isWaived && (
                                  <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                    {currentQuote.isChineseEnabled ? '已免除費用' : 'Waived'}
                                  </span>
                                )}
                                {(item.isGSTApplicable || item.isPSTApplicable) && (
                                  <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {item.isGSTApplicable && 'GST'}{item.isGSTApplicable && item.isPSTApplicable && '/'}{item.isPSTApplicable && 'PST'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="col-span-2 text-center">
                              <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                                {item.quantity}
                              </span>
                            </div>
                            <div className="col-span-2 text-right">
                              <span className="text-xs font-medium text-slate-600">
                                ${item.unitPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}
                              </span>
                            </div>
                            <div className="col-span-2 text-right">
                              <span className={`text-sm font-black ${item.isWaived ? 'line-through text-slate-300' : 'text-slate-900'}`}>
                                ${item.total.toLocaleString(undefined, {minimumFractionDigits: 2})}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Section: Responsive 2-column on iPad/Desktop, stacked on Mobile */}
              <div className="pt-6 border-t-2 border-slate-100 md:grid md:grid-cols-12 md:gap-8 items-start space-y-6 md:space-y-0">
                {/* Left Column on iPad/Desktop: Photo, Terms & Actions */}
                <div className="md:col-span-6 lg:col-span-7 space-y-5">
                  {/* Attached Image (if uploaded) */}
                  {currentQuote.imageUrl && (
                    <div className="rounded-2xl border border-slate-200/80 p-3.5 bg-slate-50/50 space-y-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        {currentQuote.isChineseEnabled ? '實景參考圖' : 'Attached Photo'}
                      </span>
                      <div className="w-full rounded-xl overflow-hidden bg-white border border-slate-200/60 p-2 flex items-center justify-center max-h-72">
                        <img src={currentQuote.imageUrl} alt="Quote Reference" className="max-h-64 max-w-full object-contain rounded-lg shadow-xs" />
                      </div>
                    </div>
                  )}

                  {/* Terms and conditions */}
                  {currentQuote.terms && (
                    <div className="rounded-2xl border border-slate-200/80 p-4 bg-slate-50/40 space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        {currentQuote.isChineseEnabled ? '條款與附註 / Terms & Notes' : 'Terms & Conditions'}
                      </span>
                      <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {currentQuote.terms}
                      </p>
                    </div>
                  )}

                  {/* Quick Action to view formal A4 sheet on tablet/desktop */}
                  <div className="hidden md:flex items-center gap-3 pt-2">
                    <button 
                      onClick={() => setReviewModeView('a4')}
                      className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all flex items-center gap-1.5 active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                      <span>{currentQuote.isChineseEnabled ? '查看正式 A4 列印頁面 →' : 'View Standard A4 Print Sheet →'}</span>
                    </button>
                  </div>
                </div>

                {/* Right Column on iPad/Desktop: Financial Summary Statement */}
                <div className="md:col-span-6 lg:col-span-5">
                  <div className="bg-slate-50/90 rounded-2xl border border-slate-200/80 p-5 md:p-6 space-y-3 shadow-xs">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block pb-1 border-b border-slate-200/60">
                      {currentQuote.isChineseEnabled ? '結算明細' : 'Financial Statement'}
                    </span>

                    <div className="flex justify-between text-xs text-slate-600">
                      <span>{currentQuote.isChineseEnabled ? '稅前原價' : 'Gross Subtotal'}</span>
                      <span className="font-semibold text-slate-800">${currentQuote.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>

                    {manualWaiveValue > 0 && (
                      <div className="flex justify-between text-xs text-emerald-600 font-medium">
                        <span>{currentQuote.manualDiscountName || (currentQuote.isChineseEnabled ? '手動減免' : 'Manual Waive')}</span>
                        <span>-${manualWaiveValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                      </div>
                    )}

                    {effectivePercentSavings > 0 && (
                      <div className="flex justify-between text-xs text-emerald-600 font-medium">
                        <span>{currentQuote.isChineseEnabled ? '特別折扣' : 'Discount'} ({currentQuote.discountPercent}%)</span>
                        <span>-${effectivePercentSavings.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-xs text-slate-600 pt-2 border-t border-slate-200/70">
                      <span>{currentQuote.isChineseEnabled ? '稅前淨計' : 'Net Pre-Tax Subtotal'}</span>
                      <span className="font-semibold text-slate-800">${actualSubtotalPreTax.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>

                    <div className="flex justify-between text-xs text-slate-600">
                      <span>GST (5%)</span>
                      <span className="font-medium text-slate-800">${currentQuote.gstTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>

                    {currentQuote.pstTotal > 0 && (
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>PST (7%)</span>
                        <span className="font-medium text-slate-800">${currentQuote.pstTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                      </div>
                    )}

                    <div className="pt-3 border-t-2 border-slate-900 flex justify-between items-center text-sm font-black text-slate-900">
                      <span>{currentQuote.isChineseEnabled ? '應付總額' : 'TOTAL DUE'}</span>
                      <span className="text-xl md:text-2xl text-blue-600 font-black">${currentQuote.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>

                    {/* Prominent Action Button for iPad & Desktop inside summary card */}
                    <div className="pt-3">
                      <button 
                        onClick={() => handleSavePDF(true)} 
                        disabled={isGeneratingPDF}
                        className={`w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs md:text-sm rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all active:scale-95 ${isGeneratingPDF ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        <span>{isGeneratingPDF ? (currentQuote.isChineseEnabled ? "正在生成 A4..." : "Generating A4...") : (currentQuote.isChineseEnabled ? "生成 A4 PDF / 列印" : "Save as PDF / Print")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sticky Bottom Action Bar for Mobile View (thumb friendly) */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 p-3.5 bg-white/95 backdrop-blur-md border-t border-slate-200 z-50 flex items-center justify-between shadow-[0_-4px_25px_rgba(0,0,0,0.08)] print:hidden">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                  {currentQuote.isChineseEnabled ? '應付總額' : 'Total Due'}
                </span>
                <span className="text-xl font-black text-blue-600 leading-tight">
                  ${currentQuote.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}
                </span>
              </div>
              
              <button 
                onClick={() => handleSavePDF(true)} 
                disabled={isGeneratingPDF}
                className="px-5 py-3 bg-blue-600 text-white font-black text-xs rounded-xl shadow-lg shadow-blue-500/25 flex items-center gap-2 hover:bg-blue-700 active:scale-95 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                <span>{isGeneratingPDF ? (currentQuote.isChineseEnabled ? "正在生成 A4..." : "Generating A4...") : (currentQuote.isChineseEnabled ? "生成 A4 PDF / 列印" : "Save as PDF / Print")}</span>
              </button>
            </div>
          </div>
        ) : (
          /* View 2: Formal A4 Printable Document View */
          <div className="max-w-4xl mx-auto flex flex-col gap-4 md:gap-6 p-2 sm:p-4 md:p-12 print:p-0 print:m-0 print:max-w-none">
            <div className="md:hidden text-center text-xs text-slate-500 font-medium py-1 print:hidden">
              {currentQuote.isChineseEnabled ? '↔ 左右滑動查看完整 A4 報價單' : '↔ Swipe horizontally to view full A4 sheet'}
            </div>
            <div className="w-full overflow-x-auto flex justify-start md:justify-center bg-slate-200 py-4 md:py-8 px-2 md:px-0 rounded-2xl print:bg-white print:p-0 print:block">
              <div 
                id="quote-page" 
                ref={quoteRef} 
                className={`bg-white w-[210mm] shrink-0 ${containerPaddingClass} ${isGeneratingPDF ? 'overflow-hidden' : 'shadow-2xl'} flex flex-col box-border`}
                style={isGeneratingPDF ? { minHeight: '0', height: 'auto' } : { minHeight: '297mm' }}
              >
              <div className={`flex justify-between items-start ${isDense ? 'mb-2 pb-1.5' : 'mb-6 pb-4'} border-b-2 border-slate-900`}>
                <div>
                  <h1 className="text-4xl font-black text-slate-900 tracking-tighter leading-none">QUOTE</h1>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Ref: {currentQuote.id.split('-').pop()} • Date: {currentQuote.date}</p>
                  {currentQuote.clientName && (
                    <p className="text-sm font-bold text-slate-700 mt-1 uppercase tracking-tight">For: {currentQuote.clientName}</p>
                  )}
                </div>
                <div className="text-right">
                  <h2 className="text-lg font-black text-blue-600 leading-tight">{currentQuote.businessInfo.name}</h2>
                  <div className="text-[9px] text-slate-500 font-medium leading-tight">
                    <p>{currentQuote.businessInfo.address}</p>
                    <p>{currentQuote.businessInfo.email} • {currentQuote.businessInfo.phone}</p>
                  </div>
                </div>
              </div>
              <div className="w-full">
                {propertyItems.length > 0 && (
                  <div className={isDense ? 'mb-2' : 'mb-4'}>
                    <h4 className={`border-b border-slate-900 pb-0.5 ${isDense ? 'mb-1' : 'mb-2'} text-[10px] font-black uppercase tracking-widest`}>{currentQuote.isChineseEnabled ? '墓地選擇' : 'Property Selection'}</h4>
                    <table className="w-full">
                      <thead><tr className="border-b text-slate-400 text-[9px] font-bold uppercase"><th className="py-0.5 text-left">{currentQuote.isChineseEnabled ? '描述' : 'Description'}</th><th className="text-center w-12">{currentQuote.isChineseEnabled ? '數量' : 'Qty'}</th><th className="text-right w-24">{currentQuote.isChineseEnabled ? '單價' : 'Unit Price'}</th><th className="text-right w-24">{currentQuote.isChineseEnabled ? '總額' : 'Total'}</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {propertyItems.map(i => (<tr key={i.id} className="page-break-avoid"><td className={`${textBase} font-bold text-slate-800`}>{currentQuote.isChineseEnabled ? (i.chineseName || i.name) : i.name}</td><td className={`text-center text-slate-600 ${textBase}`}>{i.quantity}</td><td className={`text-right text-slate-600 ${textBase}`}>${i.unitPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</td><td className={`text-right font-black text-slate-900 ${textBase}`}>${i.total.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>))}
                      </tbody>
                    </table>
                  </div>
                )}
                {msItems.length > 0 && (
                  <div className={isDense ? 'mb-2' : 'mb-4'}>
                    <h4 className={`border-b border-slate-900 pb-0.5 ${isDense ? 'mb-1' : 'mb-2'} text-[10px] font-black uppercase tracking-widest`}>{currentQuote.isChineseEnabled ? '服務及項目' : 'Merchandise and Services'}</h4>
                    <table className="w-full">
                      <thead><tr className="border-b text-slate-400 text-[9px] font-bold uppercase"><th className="py-0.5 text-left">{currentQuote.isChineseEnabled ? '描述' : 'Description'}</th><th className="text-center w-12">{currentQuote.isChineseEnabled ? '數量' : 'Qty'}</th><th className="text-right w-24">{currentQuote.isChineseEnabled ? '單價' : 'Unit Price'}</th><th className="text-right w-24">{currentQuote.isChineseEnabled ? '總額' : 'Total'}</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {msItems.map(i => (<tr key={i.id} className="page-break-avoid"><td className={`${textBase} font-bold text-slate-800`}>{currentQuote.isChineseEnabled ? (i.chineseName || i.name) : i.name}</td><td className={`text-center text-slate-600 ${textBase}`}>{i.quantity}</td><td className={`text-right text-slate-600 ${textBase}`}>${i.unitPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</td><td className={`text-right font-black text-slate-900 ${textBase}`}>${i.total.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              
              {currentQuote.imageUrl ? (
                <div 
                  className={`flex flex-col justify-center items-center rounded-2xl relative group ${
                    isDense ? 'my-1' : 'my-4'
                  } border border-slate-100 bg-slate-50/50 p-3 w-full overflow-hidden`} 
                  style={{ maxHeight: `${currentQuote.imageHeight || 380}px` }}
                >
                  <div className="w-full h-full relative flex items-center justify-center">
                    <img 
                      src={currentQuote.imageUrl} 
                      alt="Quote visualization" 
                      className="max-w-full max-h-full object-contain pointer-events-none rounded-xl" 
                      style={{ 
                        maxHeight: `${(currentQuote.imageHeight || 380) - 24}px`, 
                        width: 'auto', 
                        height: 'auto',
                        display: 'block', 
                        margin: '0 auto' 
                      }}
                    />
                    
                    {/* Resize Handle */}
                    <div 
                      onMouseDown={handleResizeStart}
                      onTouchStart={handleResizeStart}
                      className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize flex justify-center items-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/5 hover:bg-slate-900/10 print:hidden"
                    >
                      <div className="w-10 h-1 bg-slate-400 rounded-full"></div>
                    </div>

                    <button 
                      onClick={() => setCurrentQuote(p => ({...p, imageUrl: undefined, imageHeight: undefined}))} 
                      className="absolute top-2 right-2 p-1.5 bg-white shadow-sm border border-slate-200 rounded-full text-red-500 opacity-0 group-hover:opacity-100 transition-opacity print:hidden active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                /* Compact trigger shown in edit/preview only when there is NO image. Hidden during print completely, leaves 0 space. */
                !isGeneratingPDF && (
                  <div className="flex justify-center my-2 print:hidden">
                    <button 
                      onClick={() => imageInputRef.current?.click()} 
                      className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-800 text-[10px] font-black uppercase tracking-widest rounded-xl border border-slate-200/60 transition-all active:scale-95 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                      {currentQuote.isChineseEnabled ? '新增實景或圖片' : 'Add Property Photo / Image'}
                    </button>
                    <input type="file" ref={imageInputRef} onChange={onImageChange} accept="image/*" className="hidden" />
                  </div>
                )
              )}

              {/* Flexible Spacer for Professional A4 Page Alignment. Shrinks to 0 when space is needed. */}
              <div className="flex-grow min-h-[12px] print:min-h-0" />

              <div className={`summary-flex-container ${isDense ? 'pt-2 gap-4' : 'pt-4 gap-10'} border-t-2 border-slate-100 grid grid-cols-2 items-end page-break-avoid`}>
                <div className="summary-left-col">
                    {currentQuote.isMonthlyPaymentEnabled && (
                      <div className={`bg-slate-50 ${isDense ? 'p-2' : 'p-4'} rounded-xl border border-slate-200/50`}>
                         <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{currentQuote.isChineseEnabled ? '分期付款方案' : 'Optional Payment Plan'}</h4>
                         <div className="space-y-0.5 text-[10px]">
                           <div className="flex justify-between text-slate-600"><span>{currentQuote.isChineseEnabled ? '訂金' : 'Down Payment'}</span><span className="font-bold text-slate-900">${currentQuote.depositAmount.toLocaleString()}</span></div>
                           <div className="flex justify-between text-slate-600"><span>{currentQuote.isChineseEnabled ? '期數' : 'Financing Term'}</span><span className="font-bold text-slate-900">{currentQuote.paymentMonths} Months</span></div>
                           <div className="flex justify-between text-slate-600"><span>{currentQuote.isChineseEnabled ? '利率' : 'Interest Rate'}</span><span className="font-bold text-slate-900">{currentQuote.interestRate}%</span></div>
                           <div className="mt-1 pt-1 border-t flex justify-between items-center"><span className="text-[10px] font-black text-blue-600 uppercase">{currentQuote.isChineseEnabled ? '每月付款' : 'Monthly Payment'}</span><span className={`${isDense ? 'text-base' : 'text-xl'} font-black text-blue-600`}>${currentQuote.monthlyPaymentAmount?.toLocaleString(undefined, {maximumFractionDigits: 2})}</span></div>
                         </div>
                      </div>
                    )}
                </div>
                <div className={`summary-right-col ${isDense ? 'space-y-0.5' : 'space-y-1.5'}`}>
                   <div className="flex justify-between text-slate-500 text-[10px]"><span>{currentQuote.isChineseEnabled ? '總計' : 'Gross Subtotal'}</span><span className="font-bold text-slate-800">${currentQuote.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                   {manualWaiveValue > 0 && (<div className="flex justify-between text-emerald-600 text-[10px] italic"><span>{currentQuote.manualDiscountName || (currentQuote.isChineseEnabled ? '手動減免' : 'Manual Waive')}</span><span className="font-bold">-${manualWaiveValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>)}
                   {effectivePercentSavings > 0 && (<div className="flex justify-between text-emerald-600 text-[10px] italic"><span>{currentQuote.isChineseEnabled ? '折扣' : 'Discount'} ({currentQuote.discountPercent}%)</span><span className="font-bold">-${effectivePercentSavings.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>)}
                   <div className={`flex justify-between text-slate-400 text-[9px] font-bold uppercase tracking-widest border-t ${isDense ? 'pt-0.5' : 'pt-1'}`}><span>{currentQuote.isChineseEnabled ? '稅額 (GST/PST)' : 'Taxes (GST/PST)'}</span><span className="text-slate-600 font-bold">${(currentQuote.gstTotal + currentQuote.pstTotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                   <div className={`flex justify-between ${isDense ? 'text-lg pt-0.5' : 'text-2xl pt-2'} font-black text-slate-900 border-t-2 border-slate-900 mt-1`}><span>{currentQuote.isChineseEnabled ? '總額' : 'TOTAL DUE'}</span><span className="text-blue-600">${currentQuote.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                </div>
              </div>
              <div className={`${isDense ? 'mt-3 pt-1.5' : 'mt-8 pt-3'} border-t border-slate-200/60 italic text-slate-500 text-[9px] leading-tight whitespace-pre-wrap page-break-avoid`}>{currentQuote.terms}</div>
            </div>
          </div>
        </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f8fafc]">
      <Sidebar 
        sources={sources} 
        activeView={activeView} 
        setActiveView={setActiveView} 
        onAddSheet={() => setActiveView('sheets')} 
        onDeleteSheet={(id) => setSources(s => s.filter(x => x.id !== id))} 
        onEditSheetName={(id, n) => setSources(prev => prev.map(s => s.id === id ? {...s, name: n} : s))} 
        isSyncing={isSyncing} 
        isVisible={isSidebarVisible}
        onClose={() => setIsSidebarVisible(false)}
        businessProfile={businessProfile}
        setBusinessProfile={setBusinessProfile}
      />
      <main className={`flex-1 p-4 md:p-8 pb-28 md:pb-12 overflow-y-auto transition-all duration-300 ${isSidebarVisible ? 'md:ml-64' : 'ml-0'} print:ml-0 print:p-0 print:overflow-visible`}>
        {/* Mobile Sticky App Header */}
        <header className="md:hidden sticky top-0 -mx-4 -mt-4 px-4 py-3 bg-white/95 backdrop-blur-md border-b border-slate-200 flex items-center justify-between z-30 mb-4 print:hidden">
          <div className="flex items-center gap-2.5">
            <button 
              onClick={() => setIsSidebarVisible(true)} 
              className="w-10 h-10 bg-slate-100 active:bg-slate-200 text-slate-700 rounded-xl flex items-center justify-center transition-all active:scale-95"
              aria-label="Open menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-slate-900 text-base leading-tight">
                  {activeView === 'builder' ? (currentQuote.isChineseEnabled ? '報價生成' : 'Quote Builder') : 
                   activeView === 'sheets' ? (currentQuote.isChineseEnabled ? '數據中心' : 'Data Sheets') : 
                   activeView === 'compare' ? (currentQuote.isChineseEnabled ? '方案對比' : 'Compare') : 
                   (currentQuote.isChineseEnabled ? '報價模板' : 'Templates')}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Wells Inc.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleToggleChinese(!currentQuote.isChineseEnabled)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-black text-slate-700 active:scale-95 transition-all"
              title="Toggle Language"
            >
              {currentQuote.isChineseEnabled ? '繁體' : 'EN'}
            </button>
            {activeView === 'builder' && (
              <button 
                onClick={handleOpenReview} 
                className="px-3.5 py-1.5 bg-blue-600 text-white font-black text-xs rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-1"
              >
                <span>{currentQuote.isChineseEnabled ? "預覽" : "Review"}</span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/></svg>
              </button>
            )}
          </div>
        </header>

        {/* Mobile Builder Secondary Quick Action Bar */}
        {activeView === 'builder' && (
          <div className="md:hidden flex gap-2 mb-4 overflow-x-auto pb-1 print:hidden">
            <button 
              onClick={handleNewQuote} 
              className="flex-1 min-w-[120px] py-2.5 px-3 bg-white border border-slate-200 rounded-xl font-bold text-xs text-blue-600 active:bg-slate-50 shadow-xs flex items-center justify-center gap-1.5 active:scale-95"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"/></svg>
              {currentQuote.isChineseEnabled ? "新建報價" : "New Quote"}
            </button>
            <button 
              onClick={handleSaveAsTemplate} 
              className="flex-1 min-w-[120px] py-2.5 px-3 bg-white border border-slate-200 rounded-xl font-bold text-xs text-slate-700 active:bg-slate-50 shadow-xs flex items-center justify-center gap-1.5 active:scale-95"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
              {currentQuote.isChineseEnabled ? "保存模板" : "Save Template"}
            </button>
          </div>
        )}

        {/* Desktop Header */}
        <header className="hidden md:flex justify-between items-center mb-8 print:hidden">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarVisible(!isSidebarVisible)} className="p-2 bg-white border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 transition-all"><svg className={`w-6 h-6 ${isSidebarVisible ? 'rotate-0' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h8m-8 6h16"/></svg></button>
            <div>
              <div className="flex items-center gap-2"><h1 className="text-3xl font-bold text-slate-900 tracking-tight">{activeView === 'builder' ? 'Quote Builder' : activeView === 'sheets' ? 'Data Repository' : 'Templates'}</h1><div className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${dbConnected ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>{dbConnected ? 'Database Live' : 'Cloud Ready'}</div></div>
              <p className="text-slate-500 text-sm">Configure pricing and generate beautiful PDF quotes.</p>
            </div>
          </div>
          {activeView === 'builder' && (
            <div className="flex gap-3">
              <button onClick={handleNewQuote} className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-sm text-blue-600 hover:bg-slate-50 shadow-sm flex items-center gap-2 active:scale-95 transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                {currentQuote.isChineseEnabled ? "新建報價" : "New Quote"}
              </button>
              <button onClick={handleSaveAsTemplate} className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-sm text-slate-700 hover:bg-slate-50 shadow-sm flex items-center gap-2 active:scale-95 transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                {currentQuote.isChineseEnabled ? "保存模板" : "Save Template"}
              </button>
              <button onClick={handleOpenReview} className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2">
                {currentQuote.isChineseEnabled ? "預覽並結算 →" : "Review & Finalize →"}
              </button>
            </div>
          )}
        </header>

        {activeView === 'builder' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 flex flex-col">
                <div className="flex justify-between items-center">
                   <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Global Settings</h3>
                   <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-1 rounded-full border border-slate-200 hover:bg-slate-100 transition-colors">
                      <input type="checkbox" checked={currentQuote.isChineseEnabled} onChange={(e) => handleToggleChinese(e.target.checked)} className="w-4 h-4 rounded text-blue-600 border-slate-300" />
                      <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Traditional Chinese / 繁體中文</span>
                   </label>
                </div>
                <div className="space-y-4 flex-1">
                  <input type="text" value={currentQuote.clientName} onChange={(e) => setCurrentQuote(p => ({...p, clientName: e.target.value}))} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50/50" placeholder="Client Name..." />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative flex flex-col">
                      <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-1">Savings %</label>
                      <div className="relative">
                        <input type="number" value={currentQuote.discountPercent || ''} onChange={(e) => setCurrentQuote(p => ({...p, discountPercent: parseFloat(e.target.value) || 0}))} className="w-full border border-slate-200 rounded-xl pl-4 pr-10 py-2.5 text-sm font-bold text-emerald-600 bg-slate-50/30" placeholder="0" />
                        <span className="absolute right-4 top-2.5 font-bold text-emerald-600">%</span>
                      </div>
                    </div>
                    <div className="relative flex flex-col">
                      <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-1">Manual Waive $</label>
                      <div className="relative">
                        <input type="number" value={currentQuote.manualDiscountAmount || ''} onChange={(e) => setCurrentQuote(p => ({...p, manualDiscountAmount: parseFloat(e.target.value) || 0}))} className="w-full border border-slate-200 rounded-xl pl-8 pr-4 py-2.5 text-sm font-bold text-emerald-600 bg-slate-50/30" placeholder="0.00" />
                        <span className="absolute left-4 top-2.5 font-bold text-emerald-600">$</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 block">{currentQuote.isChineseEnabled ? '備註 / 條款 (Editable Remarks)' : 'Remarks / Terms (Editable)'}</label>
                    <textarea 
                      value={currentQuote.terms} 
                      onChange={(e) => setCurrentQuote(p => ({ ...p, terms: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50/30 min-h-[80px]"
                      placeholder="Pricing notes, terms of sale..."
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Catalog Selection</h3>
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  <button onClick={() => setSelectedSection('Property')} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${selectedSection === 'Property' ? 'bg-white text-blue-600 shadow-sm border border-slate-200' : 'text-slate-500'}`}>PROPERTY</button>
                  <button onClick={() => setSelectedSection('Merchandise and Services')} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${selectedSection === 'Merchandise and Services' ? 'bg-white text-emerald-600 shadow-sm border border-slate-200' : 'text-slate-500'}`}>M&S</button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                   <select value={selectedSourceId} onChange={(e) => { setSelectedSourceId(e.target.value); setSelectedSubcategory(''); }} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs bg-white">
                     <option value="">Choose source...</option>
                     {availableSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                   </select>
                   {availableSubcategories.length > 0 && (
                     <div>
                       <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-1 block">Category / Series</label>
                       <select value={selectedSubcategory} onChange={(e) => setSelectedSubcategory(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs bg-white font-medium">
                          <option value="">All Categories</option>
                          {availableSubcategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                       </select>
                     </div>
                   )}
                   <select className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs bg-slate-900 text-white font-bold" value="" onChange={(e) => { const item = filteredItems.find(x => x.id === e.target.value); if (item) addItemToQuote(item); }}>
                     <option value="" disabled>Select item...</option>
                     {filteredItems.map(item => <option key={item.id} value={item.id}>{currentQuote.isChineseEnabled && item.chineseName ? item.chineseName : item.name} — ${item.price.toLocaleString()}</option>)}
                   </select>
                </div>
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                   <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={currentQuote.isMonthlyPaymentEnabled} onChange={(e) => setCurrentQuote(p => ({...p, isMonthlyPaymentEnabled: e.target.checked}))} className="w-4 h-4 rounded-lg text-blue-600 border-slate-300" />
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{currentQuote.isChineseEnabled ? '分期付款' : 'Enable Payments'}</span>
                      </label>
                   </div>
                   {currentQuote.isMonthlyPaymentEnabled && (
                     <div className="flex gap-4 animate-in fade-in slide-in-from-right-2">
                        <div className="text-right">
                          <span className="block text-[8px] font-bold text-slate-400 uppercase">{currentQuote.isChineseEnabled ? '訂金 $' : 'Down Payment $'}</span>
                          <input 
                            type="number" 
                            value={currentQuote.depositAmount || ''} 
                            onChange={(e) => { setIsDepositManual(true); setCurrentQuote(p => ({...p, depositAmount: parseFloat(e.target.value) || 0})); }} 
                            className={`w-24 text-right text-xs font-bold border-b outline-none transition-colors ${currentQuote.depositAmount < currentQuote.grandTotal * 0.1 ? 'border-red-500 text-red-600 bg-red-50' : 'border-slate-200 text-blue-600'}`} 
                          />
                          {currentQuote.depositAmount < currentQuote.grandTotal * 0.1 && (
                            <span className="block text-[7px] text-red-500 font-bold uppercase mt-1">Min 10% Policy</span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="block text-[8px] font-bold text-slate-400 uppercase">{currentQuote.isChineseEnabled ? '期數' : 'Term (Mo)'}</span>
                          <input type="number" value={currentQuote.paymentMonths} onChange={(e) => setCurrentQuote(p => ({...p, paymentMonths: parseInt(e.target.value) || 0}))} className="w-12 text-right text-xs font-bold border-b border-slate-200 outline-none" />
                        </div>
                        <div className="text-right">
                          <span className="block text-[8px] font-bold text-slate-400 uppercase">{currentQuote.isChineseEnabled ? '利率 %' : 'Rate %'}</span>
                          <input type="number" value={currentQuote.interestRate} onChange={(e) => setCurrentQuote(p => ({...p, interestRate: parseFloat(e.target.value) || 0}))} className="w-12 text-right text-xs font-bold border-b border-slate-200 outline-none" />
                        </div>
                     </div>
                   )}
                </div>
              </div>
            </section>

            <QuoteTable items={currentQuote.items} onRemove={(id) => setCurrentQuote(p => ({...p, items: p.items.filter(x => x.id !== id)}))} onUpdateQty={(id, q) => setCurrentQuote(p => ({...p, items: p.items.map(x => x.id === id ? {...x, quantity: q, total: x.unitPrice * q} : x)}))} onUpdateTaxes={(id, g, ps) => setCurrentQuote(p => ({...p, items: p.items.map(x => x.id === id ? {...x, isGSTApplicable: g, isPSTApplicable: ps} : x)}))} onUpdateDiscountable={(id, d) => setCurrentQuote(p => ({...p, items: p.items.map(x => x.id === id ? {...x, isDiscountable: d} : x)}))} onUpdateWaived={(id, w) => setCurrentQuote(p => ({...p, items: p.items.map(x => x.id === id ? {...x, isWaived: w} : x)}))} onMoveItem={(d, h) => { setCurrentQuote(p => { const items = [...p.items]; const dIdx = items.findIndex(x => x.id === d); const hIdx = items.findIndex(x => x.id === h); if (dIdx < 0 || hIdx < 0) return p; const [removed] = items.splice(dIdx, 1); items.splice(hIdx, 0, removed); return { ...p, items }; }); }} showChinese={currentQuote.isChineseEnabled} />

            <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6">
               <div className="flex justify-between w-full md:w-auto md:justify-start gap-6 md:gap-8 items-center">
                  <div className="text-left"><span className="block text-[10px] font-black text-slate-400 uppercase">{currentQuote.isChineseEnabled ? '稅前總計' : 'Gross Subtotal'}</span><span className="text-lg md:text-xl font-bold text-slate-800">${currentQuote.subtotal.toLocaleString()}</span></div>
                  <div className="text-right md:text-left"><span className="block text-[10px] font-black text-blue-600 uppercase">{currentQuote.isChineseEnabled ? '總金額' : 'Grand Total'}</span><span className="text-3xl md:text-4xl font-black text-blue-600 tracking-tighter">${currentQuote.grandTotal.toLocaleString()}</span></div>
               </div>
               <button onClick={handleOpenReview} className="w-full md:w-auto px-8 md:px-12 py-4 md:py-5 bg-slate-900 text-white font-black rounded-2xl shadow-xl hover:bg-slate-800 active:scale-95 transition-all text-base md:text-lg flex items-center justify-center gap-2">
                 <span>{currentQuote.isChineseEnabled ? "生成報價 →" : "Generate Quote →"}</span>
               </button>
            </div>
            
            <div className="bg-slate-100/50 p-6 rounded-2xl border border-dashed border-slate-200">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{currentQuote.isChineseEnabled ? '手動項目輸入' : 'Manual Item Entry'}</h4>
               <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                  <input type="text" placeholder={currentQuote.isChineseEnabled ? "項目名稱 (EN)" : "Item Name (EN)"} value={customName} onChange={(e) => setCustomName(e.target.value)} className="sm:col-span-2 border border-slate-200 rounded-xl px-4 py-2 text-sm bg-white focus:ring-1 focus:ring-blue-500 outline-none" />
                  <input type="text" placeholder={currentQuote.isChineseEnabled ? "項目名稱 (ZH)" : "Item Name (ZH)"} value={customChineseName} onChange={(e) => setCustomChineseName(e.target.value)} className="sm:col-span-2 border border-slate-200 rounded-xl px-4 py-2 text-sm bg-white focus:ring-1 focus:ring-blue-500 outline-none" />
                  <input type="number" placeholder={currentQuote.isChineseEnabled ? "價格" : "Price"} value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} className="border border-slate-200 rounded-xl px-4 py-2 text-sm bg-white focus:ring-1 focus:ring-blue-500 outline-none" />
                  <div className="flex gap-2">
                    <select value={customSection} onChange={(e) => setCustomSection(e.target.value as any)} className="flex-1 border border-slate-200 rounded-xl px-2 py-2 text-[10px] font-black uppercase bg-white">
                      <option value="Merchandise and Services">M&S</option>
                      <option value="Property">Prop</option>
                    </select>
                    <button onClick={handleAddCustomItem} className="px-4 bg-slate-400 text-white rounded-xl font-black text-[10px] uppercase hover:bg-slate-500 transition-colors">Add</button>
                  </div>
               </div>
            </div>
          </div>
        )}

        {/* DATA REPOSITORY VIEW */}
        {activeView === 'sheets' && (
          <div className="space-y-12 pb-24 animate-in fade-in">
            <header className="flex justify-between items-end">
              <div><h2 className="text-3xl font-bold text-slate-900 tracking-tight">Data Repository</h2><p className="text-slate-500 text-sm">Synchronize pricing data or upload local CSV files.</p></div>
              <div className="flex gap-3">
                <button 
                  onClick={handleSaveWorkspaceConfig} 
                  disabled={isSyncing}
                  className="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 shadow-lg transition-all flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                  Preset Workspace Config
                </button>
                <button onClick={loadCloudDatabase} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-xs text-slate-600 hover:bg-slate-50 shadow-sm transition-all">Sync with Cloud</button>
              </div>
            </header>
            
            <section className="bg-blue-600 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
               <h2 className="text-2xl font-black mb-8 relative z-10">Global Cloud Sheets</h2>
               <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                 {isLoadingDb ? [1,2,3].map(i => <div key={i} className="h-40 bg-white/10 rounded-3xl animate-pulse"></div>) : 
                 dbSheets.map(s => (
                   <div key={s.id} className="bg-white rounded-[2rem] p-6 text-slate-800 shadow-xl group hover:-translate-y-1 transition-all duration-300">
                      <div className="flex justify-between items-start mb-4"><span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${s.section === 'Property' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'}`}>{s.section === 'Property' ? 'PROPERTY' : 'M&S'}</span></div>
                      <h4 className="font-bold text-lg leading-tight mb-1 truncate">{s.name}</h4>
                      <p className="text-[10px] text-slate-400 italic mb-6 line-clamp-2">{s.description || 'Global pricing catalog entry.'}</p>
                      <button onClick={() => handleConnectDatabaseSheet(s)} disabled={sources.some(x => x.id === s.id)} className={`w-full py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${sources.some(x => x.id === s.id) ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg'}`}>{sources.some(x => x.id === s.id) ? '✓ In Workspace' : 'Add to Workspace'}</button>
                   </div>
                 ))}
               </div>
            </section>

            <section className="space-y-8">
              <h3 className="text-2xl font-black text-slate-800">Workspace Configuration / 工作空間配置</h3>
              <div className="space-y-6">
                {sources.map((s, idx) => (
                  <div key={s.id} className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-8 relative overflow-hidden transition-all hover:border-blue-200">
                    <div className={`absolute top-0 left-0 w-2 h-full ${s.section === 'Property' ? 'bg-blue-500' : 'bg-emerald-500'}`}></div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col gap-1">
                          <button 
                            onClick={() => handleMoveSource(s.id, 'up')} 
                            disabled={idx === 0}
                            className={`p-1 rounded hover:bg-slate-100 transition-colors ${idx === 0 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400'}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"/></svg>
                          </button>
                          <button 
                            onClick={() => handleMoveSource(s.id, 'down')} 
                            disabled={idx === sources.length - 1}
                            className={`p-1 rounded hover:bg-slate-100 transition-colors ${idx === sources.length - 1 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400'}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
                          </button>
                        </div>
                        <input type="text" value={s.name} onChange={(e) => setSources(prev => prev.map(x => x.id === s.id ? {...x, name: e.target.value} : x))} className="text-xl font-black border-b-2 border-transparent focus:border-blue-500 outline-none text-slate-800 w-64 bg-transparent" />
                      </div>
                      <button onClick={() => {
                        setSources(p => p.filter(x => x.id !== s.id));
                        setCatalog(p => p.filter(x => x.sourceId !== s.id));
                      }} className="text-slate-300 hover:text-red-500 p-2"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Description Column (English)</label>
                        <select className="w-full border border-slate-200 rounded-2xl px-4 py-3 text-xs bg-slate-50 font-bold" value={s.descriptionColumn || ''} onChange={(e) => handleUpdateMapping(s.id, e.target.value, s.priceColumn || '', s.subcategoryColumn || 'none', s.ecfPriceColumn, s.isECFIncluded, s.extraMappings, s.chineseDescriptionColumn)}>
                          {s.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Chinese Description Column</label>
                        <select className="w-full border border-slate-200 rounded-2xl px-4 py-3 text-xs bg-slate-50 font-bold text-blue-600" value={s.chineseDescriptionColumn || 'none'} onChange={(e) => handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', s.subcategoryColumn || 'none', s.ecfPriceColumn, s.isECFIncluded, s.extraMappings, e.target.value)}>
                          <option value="none">No Chinese Column</option>
                          {s.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Unit Price Column</label>
                        <select className="w-full border border-slate-200 rounded-2xl px-4 py-3 text-xs bg-slate-50 font-bold" value={s.priceColumn || ''} onChange={(e) => handleUpdateMapping(s.id, s.descriptionColumn || '', e.target.value, s.subcategoryColumn || 'none', s.ecfPriceColumn, s.isECFIncluded, s.extraMappings, s.chineseDescriptionColumn)}>
                          {s.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category / Series Column</label>
                        <select className="w-full border border-slate-200 rounded-2xl px-4 py-3 text-xs bg-slate-50 font-bold" value={s.subcategoryColumn || 'none'} onChange={(e) => handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', e.target.value, s.ecfPriceColumn, s.isECFIncluded, s.extraMappings, s.chineseDescriptionColumn)}>
                          <option value="none">Disabled</option>
                          {s.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    </div>

                    {s.section === 'Property' ? (
                      <div className="border-t border-slate-100 pt-8 space-y-6">
                        <div className="flex items-center gap-3"><input id={`inc-${s.id}`} type="checkbox" checked={s.isECFIncluded} onChange={(e) => handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', s.subcategoryColumn || 'none', s.ecfPriceColumn, e.target.checked, s.extraMappings, s.chineseDescriptionColumn)} className="w-6 h-6 rounded text-blue-600" /><label htmlFor={`inc-${s.id}`} className="font-bold text-slate-700">ECF included (90/10 rule)</label></div>
                        {!s.isECFIncluded && (
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Separate ECF Price Column</label>
                            <select className="w-full border border-blue-200 rounded-2xl px-4 py-3 text-xs bg-white font-bold" value={s.ecfPriceColumn || 'none'} onChange={(e) => handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', s.subcategoryColumn || 'none', e.target.value, false, s.extraMappings, s.chineseDescriptionColumn)}><option value="none">None</option>{s.headers.map(h => <option key={h} value={h}>{h}</option>)}</select>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="border-t border-slate-100 pt-8 space-y-4">
                         <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Extra Fee Mappings / 額外費用映射</h4>
                         <div className="space-y-3">
                            {s.extraMappings?.map((m, idx) => (
                              <div key={idx} className="flex gap-4 items-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                 <div className="flex-1 space-y-1">
                                   <label className="text-[8px] font-bold text-slate-400 uppercase">Fee Name Col</label>
                                   <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs bg-white font-bold" value={m.name} onChange={(e) => { const x = [...(s.extraMappings || [])]; x[idx].name = e.target.value; handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', s.subcategoryColumn || 'none', s.ecfPriceColumn, s.isECFIncluded, x, s.chineseDescriptionColumn); }}><option value="">Header Name...</option>{s.headers.map(h => <option key={h} value={h}>{h}</option>)}</select>
                                 </div>
                                 <div className="flex-1 space-y-1">
                                   <label className="text-[8px] font-bold text-slate-400 uppercase">ZH Name Col</label>
                                   <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs bg-white font-bold text-blue-600" value={m.chineseColumn || 'none'} onChange={(e) => { const x = [...(s.extraMappings || [])]; x[idx].chineseColumn = e.target.value; handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', s.subcategoryColumn || 'none', s.ecfPriceColumn, s.isECFIncluded, x, s.chineseDescriptionColumn); }}><option value="none">None (Default ZH)</option>{s.headers.map(h => <option key={h} value={h}>{h}</option>)}</select>
                                 </div>
                                 <div className="flex-1 space-y-1">
                                   <label className="text-[8px] font-bold text-slate-400 uppercase">Price Col</label>
                                    <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs bg-white font-bold" value={m.column} onChange={(e) => { const x = [...(s.extraMappings || [])]; x[idx].column = e.target.value; handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', s.subcategoryColumn || 'none', s.ecfPriceColumn, s.isECFIncluded, x, s.chineseDescriptionColumn); }}><option value="none">Value...</option>{s.headers.map(h => <option key={h} value={h}>{h}</option>)}</select>
                                  </div>
                                  <button onClick={() => { const x = (s.extraMappings || []).filter((_, i) => i !== idx); handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', s.subcategoryColumn || 'none', s.ecfPriceColumn, s.isECFIncluded, x, s.chineseDescriptionColumn); }} className="text-red-400 hover:text-red-600 p-2"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
                              </div>
                            ))}
                            <button onClick={() => { const x = [...(s.extraMappings || []), { name: '', column: 'none', chineseColumn: 'none' }]; handleUpdateMapping(s.id, s.descriptionColumn || '', s.priceColumn || '', s.subcategoryColumn || 'none', s.ecfPriceColumn, s.isECFIncluded, x, s.chineseDescriptionColumn); }} className="text-[10px] font-black text-blue-600 px-4 py-2 rounded-xl border-2 border-dashed border-blue-200 transition-all">+ Add Rule / 添加規則</button>
                         </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Comparison Tool view */}
        {activeView === 'compare' && (
          <div className="w-full max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4">
             {/* Main control bar */}
             <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6 border-b border-slate-100 pb-6 px-2 md:px-4 print:hidden">
                <div>
                   <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">{currentQuote.isChineseEnabled ? '對比工具' : 'Comparison Tool'}</h2>
                   <p className="text-xs md:text-sm text-slate-500 font-medium">{currentQuote.isChineseEnabled ? '並排對比不同方案，清晰展現差異' : 'Compare different options side-by-side to highlight key differences'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button 
                    onClick={() => setComparisonQuotes([])}
                    className="px-5 py-2 text-slate-400 hover:text-red-500 font-bold text-[10px] uppercase tracking-[0.2em] transition-colors"
                  >
                    {currentQuote.isChineseEnabled ? '清空所有' : 'Remove All'}
                  </button>
                  {currentQuote.items.length > 0 && (
                    <button 
                      onClick={() => {
                        if (comparisonQuotes.length >= 3) {
                          alert(currentQuote.isChineseEnabled ? "最多只能對比 3 個方案。" : "Max 3 options allowed for side-by-side comparison.");
                          return;
                        }
                        const newId = `CMP-${Date.now()}`;
                        const newCompareQuote: Quote = {
                          ...currentQuote,
                          id: newId,
                          clientName: currentQuote.clientName || `Option ${comparisonQuotes.length + 1}`,
                          items: getPrintOrderedItems(currentQuote.items),
                        };
                        setComparisonQuotes(prev => [...prev, newCompareQuote]);
                      }}
                      className="px-5 py-3 bg-blue-50 text-blue-600 hover:bg-blue-100 font-black text-[10px] uppercase tracking-widest rounded-2xl transition-all flex items-center gap-2 active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"/></svg>
                      {currentQuote.isChineseEnabled ? '加入當前報價' : 'Add Current Quote'}
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      if (comparisonQuotes.length >= 3) {
                        alert(currentQuote.isChineseEnabled ? "最多只能對比 3 個方案。" : "Max 3 options allowed for side-by-side comparison.");
                        return;
                      }
                      const newId = `CMP-${Date.now()}`;
                      const newCompareQuote: Quote = {
                        id: newId,
                        clientName: `Option ${comparisonQuotes.length + 1}`,
                        date: new Date().toLocaleDateString(),
                        items: [],
                        subtotal: 0,
                        discountPercent: 0,
                        manualDiscountAmount: 0,
                        manualDiscountName: 'Miscellaneous Waived',
                        gstRate: DEFAULT_GST,
                        pstRate: FIXED_PST,
                        gstTotal: 0,
                        pstTotal: 0,
                        grandTotal: 0,
                        status: 'draft',
                        terms: currentQuote.isChineseEnabled ? DEFAULT_TERMS_ZH : DEFAULT_TERMS_EN,
                        businessInfo: businessProfile,
                        isMonthlyPaymentEnabled: false,
                        depositAmount: 0,
                        interestRate: 0,
                        paymentMonths: 60,
                        isChineseEnabled: currentQuote.isChineseEnabled,
                        imageUrl: undefined
                      };
                      setComparisonQuotes(prev => [...prev, newCompareQuote]);
                    }}
                    className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-xl shadow-slate-900/10 hover:shadow-slate-900/20 hover:-translate-y-0.5 transition-all active:scale-95 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"/></svg>
                    {currentQuote.isChineseEnabled ? '新增方案' : 'Add Option'}
                  </button>
                  {comparisonQuotes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 md:gap-4 mt-2 lg:mt-0 w-full lg:w-auto">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <div className="relative">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={showCompareDetails}
                            onChange={(e) => setShowCompareDetails(e.target.checked)}
                          />
                          <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-blue-600 transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                        </div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider group-hover:text-blue-600 transition-colors">
                          {currentQuote.isChineseEnabled ? '詳細' : 'Details'}
                        </span>
                      </label>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">{currentQuote.isChineseEnabled ? '縮放' : 'Scale'}:</span>
                        <select 
                          value={comparisonScale} 
                          onChange={(e) => setComparisonScale(e.target.value as any)} 
                          className="text-xs font-bold bg-slate-100 border-none rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        >
                          <option value="auto">{currentQuote.isChineseEnabled ? '自動單頁' : 'Auto Fit'}</option>
                          <option value="standard">{currentQuote.isChineseEnabled ? '標準' : 'Standard'}</option>
                          <option value="compact">{currentQuote.isChineseEnabled ? '緊湊' : 'Compact'}</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">{currentQuote.isChineseEnabled ? '圖高' : 'Img'}:</span>
                        <select 
                          value={compareImgHeight} 
                          onChange={(e) => setCompareImgHeight(Number(e.target.value))} 
                          className="text-xs font-bold bg-slate-100 border-none rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        >
                          <option value={80}>{currentQuote.isChineseEnabled ? '小 (80px)' : 'Small (80px)'}</option>
                          <option value={130}>{currentQuote.isChineseEnabled ? '中 (130px)' : 'Medium (130px)'}</option>
                          <option value={180}>{currentQuote.isChineseEnabled ? '大 (180px)' : 'Large (180px)'}</option>
                          <option value={240}>{currentQuote.isChineseEnabled ? '特大 (240px)' : 'Extra Large (240px)'}</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2 ml-auto lg:ml-0">
                        <button 
                          onClick={() => setIsComparisonReviewMode(!isComparisonReviewMode)}
                          className={`px-4 md:px-5 py-2 ${isComparisonReviewMode ? 'bg-blue-600 text-white' : 'bg-emerald-500 text-white'} font-black text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95`}
                        >
                          {isComparisonReviewMode ? (currentQuote.isChineseEnabled ? '編輯' : 'Edit') : (currentQuote.isChineseEnabled ? '打印預覽' : 'Preview')}
                        </button>

                        {isComparisonReviewMode && (
                          <button 
                            onClick={() => window.print()}
                            className="px-4 md:px-5 py-2 bg-slate-900 text-white font-black text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1.5 hover:bg-slate-800"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                            {currentQuote.isChineseEnabled ? '列印' : 'Print'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
             </div>

             {/* Dynamic style sheet to force side-by-side during landscape printing and hide clutter */}
             {activeView === 'compare' && isComparisonReviewMode && (
               <style dangerouslySetInnerHTML={{ __html: `
                 @media print {
                   @page {
                     size: A4 landscape !important;
                     margin: 5mm !important;
                   }
                   * {
                     -webkit-print-color-adjust: exact !important;
                     print-color-adjust: exact !important;
                   }
                   html, body {
                     width: 100% !important;
                     height: 100% !important;
                     margin: 0 !important;
                     padding: 0 !important;
                     background: white !important;
                     overflow: hidden !important;
                   }
                   body * {
                     visibility: hidden !important;
                   }
                   #comparison-page, #comparison-page * {
                     visibility: visible !important;
                   }
                   #comparison-page {
                     position: fixed !important;
                     left: 0 !important;
                     top: 0 !important;
                     width: 287mm !important;
                     height: 198mm !important;
                     max-height: 198mm !important;
                     margin: 0 !important;
                     padding: ${isDenseCompare ? '3mm 5mm' : '5mm 8mm'} !important;
                     box-sizing: border-box !important;
                     border: none !important;
                     box-shadow: none !important;
                     background: white !important;
                     overflow: hidden !important;
                     display: flex !important;
                     flex-direction: column !important;
                     justify-content: space-between !important;
                   }
                   #comparison-target {
                     display: grid !important;
                     grid-template-columns: repeat(${comparisonQuotes.length}, minmax(0, 1fr)) !important;
                     gap: ${isDenseCompare ? '8px' : '16px'} !important;
                     width: 100% !important;
                     margin: 0 !important;
                     padding: 0 !important;
                   }
                   .comparison-card {
                     border: 1px solid #e2e8f0 !important;
                     border-radius: 8px !important;
                     padding: ${isDenseCompare ? '6px' : '10px'} !important;
                     background-color: #ffffff !important;
                     box-shadow: none !important;
                     break-inside: avoid !important;
                   }
                   .comparison-img-container {
                     max-height: ${isDenseCompare ? Math.min(compareImgHeight, 90) : compareImgHeight}px !important;
                     margin-bottom: ${isDenseCompare ? '4px' : '8px'} !important;
                   }
                   .comparison-img-container img {
                     max-height: ${isDenseCompare ? Math.min(compareImgHeight, 90) - 8 : compareImgHeight - 8}px !important;
                     object-fit: contain !important;
                     width: auto !important;
                     height: auto !important;
                   }
                   .comparison-item-row {
                     padding-top: ${isDenseCompare ? '1px' : '4px'} !important;
                     padding-bottom: ${isDenseCompare ? '1px' : '4px'} !important;
                   }
                 }
               ` }} />
             )}

             {comparisonQuotes.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-24 flex flex-col items-center justify-center text-center mx-4">
                   <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-8 text-slate-200">
                     <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                   </div>
                   <h3 className="text-2xl font-black text-slate-800 mb-3 tracking-tight">{currentQuote.isChineseEnabled ? '空空如也' : 'Nothing here yet'}</h3>
                   <p className="text-slate-500 max-w-sm mb-10 font-medium">{currentQuote.isChineseEnabled ? '快去從模板添加一些報價方案，或者直接點击上方按鈕手動創建方案。' : 'Head over to Templates to add existing quotes, or use the "Add Option" button above to start from scratch.'}</p>
                   <button onClick={() => setActiveView('history')} className="px-10 py-4 bg-blue-600 text-white font-black text-[11px] uppercase tracking-widest rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-95">Browse Templates</button>
                </div>
             ) : isComparisonReviewMode ? (
                /* Print Preview Mode / Presentation Mode (Landscape A4 Sheet on Slate Canvas) */
                <div className="space-y-2">
                  <div className="md:hidden text-center text-xs text-slate-500 font-medium py-1 print:hidden">
                    {currentQuote.isChineseEnabled ? '↔ 左右滑動查看完整橫向對比表' : '↔ Swipe horizontally to view full landscape comparison'}
                  </div>
                  <div className="w-full overflow-x-auto flex justify-start md:justify-center bg-slate-200 py-4 md:py-8 px-2 md:px-0 rounded-2xl print:bg-white print:p-0">
                    <div 
                      id="comparison-page" 
                      className={`bg-white w-[297mm] shrink-0 ${isDenseCompare ? 'p-[6mm]' : 'p-[10mm]'} shadow-2xl flex flex-col box-border print:shadow-none print:w-full print:p-0 justify-between`}
                      style={{ minHeight: '210mm' }}
                    >
                    <div>
                      {/* Landscape A4 Document Header */}
                      <div className={`flex justify-between items-start ${isDenseCompare ? 'mb-3 pb-2' : 'mb-6 pb-4'} border-b-2 border-slate-900`}>
                        <div>
                          <h1 className={`${isDenseCompare ? 'text-2xl' : 'text-3xl'} font-black text-slate-900 tracking-tighter leading-none`}>OPTIONS COMPARISON</h1>
                          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Ref: {currentQuote.id.split('-').pop()} • Date: {currentQuote.date}</p>
                          {currentQuote.clientName && (
                            <p className="text-xs font-bold text-slate-700 mt-1 uppercase tracking-tight">For: {currentQuote.clientName}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <h2 className={`${isDenseCompare ? 'text-sm' : 'text-base'} font-black text-blue-600 leading-tight`}>{businessProfile.name}</h2>
                          <div className="text-[8px] text-slate-500 font-medium leading-tight">
                            <p>{businessProfile.address}</p>
                            <p>{businessProfile.email} • {businessProfile.phone}</p>
                          </div>
                        </div>
                      </div>

                      {/* Side-by-Side Presentation Columns - Apple comparing iPhones style */}
                      <div 
                        id="comparison-target" 
                        className={`comparison-grid grid ${isDenseCompare ? 'gap-4' : 'gap-8'} items-stretch w-full`} 
                        style={{ gridTemplateColumns: `repeat(${comparisonQuotes.length}, minmax(0, 1fr))` }}
                      >
                        {comparisonQuotes.map((q, idx) => {
                          const optionLabel = `Option ${String.fromCharCode(65 + idx)}`;
                          const titleText = q.clientName || (q.isChineseEnabled ? `方案 ${String.fromCharCode(65 + idx)}` : optionLabel);
                          const effectiveImgHeight = isDenseCompare ? Math.min(compareImgHeight, 90) : compareImgHeight;
                          return (
                            <div key={q.id} className={`comparison-card flex flex-col justify-between text-center ${isDenseCompare ? 'pb-2' : 'pb-6'}`}>
                              <div>
                                {/* Option Header */}
                                <div className={`text-center ${isDenseCompare ? 'pb-2 mb-2' : 'pb-4 mb-4'} border-b border-slate-100`}>
                                  <h3 className={`${isDenseCompare ? 'text-base' : 'text-lg'} font-black text-slate-900 uppercase tracking-tight truncate mt-1`}>
                                    {titleText}
                                  </h3>
                                  <p className={`${isDenseCompare ? 'text-[10px]' : 'text-[11px]'} text-slate-500 font-medium leading-relaxed max-w-[220px] mx-auto mt-1`}>
                                    {q.isChineseEnabled ? (
                                      q.isMonthlyPaymentEnabled ? (
                                        <>總額 <span className="font-bold text-slate-900">${q.grandTotal.toLocaleString()}</span> 或 每月 <span className="font-bold text-slate-900">${q.monthlyPaymentAmount?.toLocaleString(undefined, {maximumFractionDigits: 2})}</span> (首付 ${q.depositAmount.toLocaleString()}, 共 {q.paymentMonths} 期 @ {q.interestRate}%)</>
                                      ) : (
                                        <>總額 <span className="font-bold text-slate-900">${q.grandTotal.toLocaleString()}</span></>
                                      )
                                    ) : (
                                      q.isMonthlyPaymentEnabled ? (
                                        <>From <span className="font-bold text-slate-900">${q.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span> or <span className="font-bold text-slate-[#0071e3]">${q.monthlyPaymentAmount?.toLocaleString(undefined, {maximumFractionDigits: 2})}/mo.</span> for {q.paymentMonths} mos. (Down ${q.depositAmount.toLocaleString()} @ {q.interestRate}%)</>
                                      ) : (
                                        <><span className="font-bold text-slate-900">${q.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></>
                                      )
                                    )}
                                  </p>
                                </div>

                                {/* Image block - shown only if image exists, no placeholder */}
                                {q.imageUrl && (
                                  <div 
                                    className={`comparison-img-container ${isDenseCompare ? 'mb-2' : 'mb-4'} w-full rounded-2xl bg-slate-50/50 border border-slate-100 flex items-center justify-center p-1.5 mx-auto max-w-[220px]`}
                                    style={{ height: `${effectiveImgHeight}px` }}
                                  >
                                    <img 
                                      src={q.imageUrl} 
                                      alt="Option visual" 
                                      className="max-w-full max-h-full object-contain pointer-events-none rounded-lg"
                                      style={{ 
                                        maxHeight: `${effectiveImgHeight - 8}px`,
                                        width: 'auto',
                                        height: 'auto',
                                        objectFit: 'contain',
                                        display: 'block',
                                        margin: '0 auto'
                                      }}
                                    />
                                  </div>
                                )}

                                {/* Items List / Specifications */}
                                {showCompareDetails && q.items.length > 0 ? (
                                  <div className={`${isDenseCompare ? 'space-y-1 py-1 pt-1.5' : 'space-y-3 py-2 pt-3'} border-t border-slate-100`}>
                                    {getPrintOrderedItems(q.items).map(item => (
                                      <div key={item.id} className={`comparison-item-row text-center ${isDenseCompare ? 'py-0.5' : 'py-1'} border-b border-slate-50 last:border-none`}>
                                        <span className={`block ${isDenseCompare ? 'text-[11px]' : 'text-xs'} font-bold text-slate-800 leading-snug`}>
                                          {q.isChineseEnabled ? (item.chineseName || item.name) : item.name}
                                        </span>
                                        <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                                          {q.isChineseEnabled ? `${item.section === 'Property' ? '墓地' : '服務'} • 數量: ${item.quantity} • 金額: $${item.total.toLocaleString()}` : `${item.section === 'Property' ? 'Property' : 'M&S'} • Qty: ${item.quantity} • Total: $${item.total.toLocaleString()}`}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="py-2 text-[9px] text-slate-400 text-center italic">
                                    {q.isChineseEnabled ? '詳細清單已收起' : 'Item details hidden'}
                                  </div>
                                )}
                              </div>

                              {/* Pricing breakdown placed at bottom - simple text layout */}
                              <div className={`${isDenseCompare ? 'space-y-1 pt-2 mt-2 text-[9px]' : 'space-y-1.5 pt-3 mt-4 text-[10px]'} border-t border-slate-100 text-slate-400 font-medium max-w-[200px] mx-auto`}>
                                <div className="flex justify-between">
                                  <span>{q.isChineseEnabled ? '小計' : 'Subtotal'}</span>
                                  <span className="font-semibold text-slate-600">${q.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                </div>
                                {q.discountPercent > 0 && (
                                  <div className="flex justify-between text-emerald-600 font-semibold">
                                    <span>{q.isChineseEnabled ? '折扣' : 'Discount'} ({q.discountPercent}%)</span>
                                    <span>-${getQuotePercentDiscountSavings(q).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span>{q.isChineseEnabled ? '稅額' : 'Tax'}</span>
                                  <span className="font-semibold text-slate-600">${(q.gstTotal + q.pstTotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Footer Terms */}
                    <div className={`${isDenseCompare ? 'mt-2 pt-1' : 'mt-4 pt-2'} border-t border-slate-200 italic text-slate-400 text-[8px] text-center leading-tight`}>
                      {currentQuote.isChineseEnabled 
                        ? '* 本對比表僅供參考，最終價格及條款以正式報價單合同為準。' 
                        : '* This comparison sheet is for illustrative purposes only. Final specifications and prices are subject to the formal contract terms.'}
                    </div>
                  </div>
                </div>
              </div>
             ) : (
                /* Interactive Side-By-Side Option Editor View */
                <div className="w-full">
                  {/* Mobile Option Tab Chips */}
                  {comparisonQuotes.length > 1 && (
                    <div className="md:hidden flex items-center gap-2 overflow-x-auto pb-3 mb-2 px-1">
                      <button
                        onClick={() => setMobileCompareOption('all')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black shrink-0 transition-all ${mobileCompareOption === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}
                      >
                        {currentQuote.isChineseEnabled ? '全部滑動' : 'Swipe All'}
                      </button>
                      {comparisonQuotes.map((q, idx) => (
                        <button
                          key={q.id}
                          onClick={() => setMobileCompareOption(idx)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black shrink-0 transition-all ${mobileCompareOption === idx ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}
                        >
                          {q.clientName || (currentQuote.isChineseEnabled ? `方案 ${String.fromCharCode(65 + idx)}` : `Option ${String.fromCharCode(65 + idx)}`)}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="w-full overflow-x-auto pb-6">
                    <div 
                      id="comparison-target" 
                      className={`min-w-0 md:min-w-[960px] ${mobileCompareOption === 'all' ? 'flex md:grid overflow-x-auto md:overflow-x-visible snap-x snap-mandatory gap-4 md:gap-6' : 'grid gap-6'} p-2`}
                      style={{ gridTemplateColumns: mobileCompareOption === 'all' ? `repeat(${comparisonQuotes.length}, minmax(0, 1fr))` : '1fr' }}
                    >
                      {comparisonQuotes
                        .filter((_, idx) => mobileCompareOption === 'all' || mobileCompareOption === idx)
                        .map((q, idx) => (
                        <div key={q.id} className="relative flex flex-col justify-between text-center pb-8 pt-4 px-2 group w-[88vw] max-w-[360px] md:w-auto shrink-0 md:shrink snap-center md:snap-align-none bg-white rounded-2xl border border-slate-200/80 shadow-xs md:bg-transparent md:border-none md:shadow-none">
                         <button 
                           onClick={() => setComparisonQuotes(prev => prev.filter(x => x.id !== q.id))} 
                           className="absolute top-1 right-1 w-6 h-6 bg-slate-50 text-slate-400 hover:text-red-500 rounded-full flex items-center justify-center hover:scale-115 transition-all opacity-0 group-hover:opacity-100 border border-slate-100 shadow-xs z-10"
                         >
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
                         </button>
                         
                         <div className="p-6 flex flex-col h-full justify-between">
                           <div>
                             {/* Option Title */}
                             <div className="mb-4 text-center">
                               <span className="block text-center text-[9px] font-black uppercase tracking-widest text-slate-400">
                                 {q.isChineseEnabled ? `方案 ${String.fromCharCode(65 + idx)}` : `Option ${String.fromCharCode(65 + idx)}`}
                               </span>
                               <input 
                                 type="text" 
                                 placeholder="Name this option..." 
                                 value={q.clientName || ''} 
                                 onChange={(e) => setComparisonQuotes(prev => prev.map(x => x.id === q.id ? { ...x, clientName: e.target.value } : x))}
                                 className="w-full text-lg font-black text-center bg-transparent focus:ring-0 outline-none text-slate-900 border-b border-dashed border-slate-200 pb-1 mt-1 focus:border-blue-500 font-sans transition-colors"
                               />
                             </div>

                             {/* Aspect-Ratio Preserving Adjustable Image Box */}
                             <div 
                               className="mb-4 w-full rounded-2xl bg-slate-50/50 border border-slate-100 relative flex items-center justify-center max-w-[220px] mx-auto p-1.5 shadow-xs"
                               style={{ height: `${compareImgHeight}px` }}
                             >
                                {q.imageUrl ? (
                                  <div className="w-full h-full relative flex items-center justify-center bg-white/80 rounded-xl p-1 group/img">
                                    <img 
                                      src={q.imageUrl} 
                                      alt="Quote visualization" 
                                      className="max-w-full max-h-full object-contain pointer-events-none rounded-lg" 
                                      style={{ 
                                        maxHeight: `${compareImgHeight - 12}px`,
                                        width: 'auto',
                                        height: 'auto',
                                        objectFit: 'contain',
                                        display: 'block' 
                                      }}
                                    />
                                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs transition-all flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 rounded-xl">
                                       <button 
                                         onClick={() => {
                                           const input = document.createElement('input');
                                           input.type = 'file';
                                           input.accept = 'image/*';
                                           input.onchange = (e: any) => {
                                             const file = e.target.files?.[0];
                                             if (!file) return;
                                             const reader = new FileReader();
                                             reader.onload = (ev) => {
                                               const url = ev.target?.result as string;
                                               setComparisonQuotes(prev => prev.map(x => x.id === q.id ? { ...x, imageUrl: url } : x));
                                             };
                                             reader.readAsDataURL(file);
                                           };
                                           input.click();
                                         }}
                                         className="px-3 py-1.5 bg-white text-slate-900 text-[10px] font-black uppercase rounded-lg shadow-md hover:bg-slate-50 transition-colors"
                                       >
                                         {q.isChineseEnabled ? '更換' : 'Change'}
                                       </button>
                                       <button 
                                         onClick={() => {
                                           setComparisonQuotes(prev => prev.map(x => x.id === q.id ? { ...x, imageUrl: undefined } : x));
                                         }}
                                         className="px-3 py-1.5 bg-red-600 text-white text-[10px] font-black uppercase rounded-lg shadow-md hover:bg-red-700 transition-colors"
                                       >
                                         {q.isChineseEnabled ? '刪除' : 'Remove'}
                                       </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div 
                                    className="flex flex-col items-center gap-1.5 cursor-pointer w-full h-full justify-center hover:bg-slate-100/60 transition-colors rounded-xl py-2" 
                                    onClick={() => {
                                      const input = document.createElement('input');
                                      input.type = 'file';
                                      input.accept = 'image/*';
                                      input.onchange = (e: any) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          const url = ev.target?.result as string;
                                          setComparisonQuotes(prev => prev.map(x => x.id === q.id ? { ...x, imageUrl: url } : x));
                                        };
                                        reader.readAsDataURL(file);
                                      };
                                      input.click();
                                    }}
                                  >
                                    <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-xs border border-slate-100 text-slate-400">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"/></svg>
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400 mt-1">{currentQuote.isChineseEnabled ? '添加圖片' : 'Add photo'}</span>
                                  </div>
                                )}
                             </div>

                             {/* Items List (Show Details) */}
                             {showCompareDetails && q.items.length > 0 && (
                               <div className="space-y-4 py-2 border-t border-slate-100 pt-4">
                                 {getPrintOrderedItems(q.items).map(item => (
                                   <div key={item.id} className="text-center py-2 border-b border-slate-50 last:border-none">
                                     <span className="block text-xs font-bold text-slate-800 leading-snug">
                                       {currentQuote.isChineseEnabled ? (item.chineseName || item.name) : item.name}
                                     </span>
                                     <span className="block text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">{currentQuote.isChineseEnabled ? `${item.section === 'Property' ? '墓地' : '服務'} • 數量: ${item.quantity} • 金額: $${item.total.toLocaleString()}` : `${item.section === 'Property' ? 'Property' : 'M&S'} • Qty: ${item.quantity} • Total: $${item.total.toLocaleString()}`}</span>
                                   </div>
                                 ))}
                               </div>
                             )}
                           </div>

                           
                         </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {/* History / Templates view */}
        {activeView === 'history' && (
          <div className="max-w-6xl space-y-8 animate-in fade-in slide-in-from-bottom-4">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900">{currentQuote.isChineseEnabled ? '儲存模板' : 'Stored Quote Templates'}</h2>
                <input type="text" placeholder="Search templates..." value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)} className="w-64 border border-slate-200 rounded-xl px-4 py-2 text-sm pl-10 focus:ring-2 focus:ring-blue-500 outline-none" />
             </div>
             {isLoadingTemplates ? (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{[1,2,3].map(i => <div key={i} className="h-48 bg-white border border-slate-200 rounded-3xl animate-pulse"></div>)}</div>) : (
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {templates.filter(t => t.template_name.toLowerCase().includes(templateSearch.toLowerCase())).map(t => (
                   <div key={t.id} className="bg-white rounded-[2rem] p-6 border border-slate-200 shadow-sm hover:shadow-xl hover:border-blue-400 transition-all duration-300 group flex flex-col">
                      <div className="flex justify-between items-start mb-4">
                         <h4 className="font-bold text-lg leading-tight group-hover:text-blue-600 transition-colors">{t.template_name}</h4>
                         <button onClick={() => deleteTemplateFromCloud(t.id).then(loadTemplates)} className="text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">Client: {t.clientName || 'Unspecified'}</p>
                      <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-slate-50">
                         <div className="flex justify-between items-center"><span className="text-[8px] font-black text-slate-400 uppercase">Grand Total</span><span className="text-xl font-black text-slate-900">${t.grandTotal.toLocaleString()}</span></div>
                         <div className="flex gap-2">
                            <button onClick={() => handleLoadTemplate(t)} className="flex-1 px-3 py-2 bg-blue-50 text-blue-600 font-black text-[9px] uppercase tracking-widest rounded-xl hover:bg-blue-600 hover:text-white transition-all">Load</button>
                            <button 
                              onClick={() => {
                                if (comparisonQuotes.length >= 3) {
                                  alert("Comparison is full (max 3 options).");
                                  return;
                                }
                                const quoteForCompare: Quote = { ...t, id: `CMP-${Date.now()}-${t.id}`, items: getPrintOrderedItems(t.items || []), date: new Date().toLocaleDateString(), status: 'draft', isChineseEnabled: !!t.isChineseEnabled, businessInfo: businessProfile };
                                setComparisonQuotes(prev => [...prev, quoteForCompare]);
                                setActiveView('compare');
                              }} 
                              className="flex-1 px-3 py-2 bg-emerald-50 text-emerald-600 font-black text-[9px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 hover:text-white transition-all"
                            >
                              + Compare
                            </button>
                         </div>
                      </div>
                   </div>
                 ))}
               </div>
             )}
          </div>
        )}
        {showEcfPrompt && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl border border-slate-100 flex flex-col gap-6 animate-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 text-blue-600">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                <h3 className="text-lg font-black text-slate-900">
                  {currentQuote.isChineseEnabled ? "管理基金 (ECF) 設定" : "Management Fund (ECF) Option"}
                </h3>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-bold text-slate-800 leading-relaxed">
                  {currentQuote.isChineseEnabled 
                    ? `此項目「${pendingCustomItem?.chineseName || pendingCustomItem?.name}」是否包含管理基金 (Is ECF included)？` 
                    : `Is ECF (Care & Maintenance Fund) included in "${pendingCustomItem?.name}"?`}
                </p>
                <div className="text-xs text-slate-500 leading-relaxed space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <p className="font-semibold text-slate-600">
                    {currentQuote.isChineseEnabled ? "規則說明：" : "Rule Details:"}
                  </p>
                  <p>
                    {currentQuote.isChineseEnabled 
                      ? "• 選擇【是】：應用 90/10 規則 (90% 部分可打折，10% 管理基金不可打折保護)。" 
                      : "• YES: Apply the 90/10 rule (90% portion is discountable, 10% portion is protected/non-discountable)."}
                  </p>
                  <p>
                    {currentQuote.isChineseEnabled 
                      ? "• 選擇【否】：不包含管理基金，項目 100% 金額都可以全額享受折扣。" 
                      : "• NO: ECF not included, item is 100% fully discountable."}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                <button 
                  id="ecf-prompt-no"
                  onClick={() => handleConfirmEcf(false)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all"
                >
                  {currentQuote.isChineseEnabled ? "否 / No (100% 折扣)" : "No (100% Disc)"}
                </button>
                <button 
                  id="ecf-prompt-yes"
                  onClick={() => handleConfirmEcf(true)}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg shadow-blue-500/20 transition-all"
                >
                  {currentQuote.isChineseEnabled ? "是 / Yes (90/10 規則)" : "Yes (90/10 Rule)"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Tab Bar (Sticky at bottom on phone) */}
      {!isReviewMode && !isComparisonReviewMode && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-1 pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.06)] print:hidden">
          <div className="grid grid-cols-4 items-center gap-1 max-w-md mx-auto">
            <button
              onClick={() => { setActiveView('builder'); setIsSidebarVisible(false); }}
              className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all active:scale-95 ${activeView === 'builder' ? 'text-blue-600 font-black' : 'text-slate-400 font-semibold hover:text-slate-600'}`}
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
              <span className="text-[10px] leading-tight">{currentQuote.isChineseEnabled ? '報價生成' : 'Builder'}</span>
            </button>

            <button
              onClick={() => { setActiveView('compare'); setIsSidebarVisible(false); }}
              className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all relative active:scale-95 ${activeView === 'compare' ? 'text-blue-600 font-black' : 'text-slate-400 font-semibold hover:text-slate-600'}`}
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              <span className="text-[10px] leading-tight">{currentQuote.isChineseEnabled ? '方案對比' : 'Compare'}</span>
              {comparisonQuotes.length > 0 && (
                <span className="absolute top-0.5 right-4 w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center">
                  {comparisonQuotes.length}
                </span>
              )}
            </button>

            <button
              onClick={() => { setActiveView('history'); setIsSidebarVisible(false); }}
              className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all active:scale-95 ${activeView === 'history' ? 'text-blue-600 font-black' : 'text-slate-400 font-semibold hover:text-slate-600'}`}
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
              <span className="text-[10px] leading-tight">{currentQuote.isChineseEnabled ? '報價模板' : 'Templates'}</span>
            </button>

            <button
              onClick={() => setIsSidebarVisible(true)}
              className="flex flex-col items-center justify-center py-1.5 rounded-xl text-slate-400 font-semibold hover:text-slate-600 active:scale-95 transition-all"
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
              <span className="text-[10px] leading-tight">{currentQuote.isChineseEnabled ? '更多設置' : 'Menu'}</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
};

export default App;