import React, { useState } from 'react';
import { QuoteLineItem } from '../types';

interface QuoteTableProps {
  items: QuoteLineItem[];
  onRemove: (id: string) => void;
  onUpdateQty: (id: string, qty: number) => void;
  onUpdateTaxes: (id: string, gst: boolean, pst: boolean) => void;
  onUpdateDiscountable: (id: string, isDiscountable: boolean) => void;
  onUpdateWaived?: (id: string, isWaived: boolean) => void;
  onMoveItem: (draggedId: string, hoverId: string) => void;
  showChinese?: boolean;
}

const QuoteTable: React.FC<QuoteTableProps> = ({ items, onRemove, onUpdateQty, onUpdateTaxes, onUpdateDiscountable, onUpdateWaived, onMoveItem, showChinese }) => {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center text-slate-400">
        <svg className="w-12 h-12 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
        <p>No items added yet. Search or use AI jumpstart above.</p>
      </div>
    );
  }

  const formatCurrency = (val: number): string => {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const propertyItems = items.filter(i => i.section === 'Property');
  const msItems = items.filter(i => i.section === 'Merchandise and Services');

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('application/x-quote-item', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedItemId(id);
    const target = e.currentTarget as HTMLElement;
    setTimeout(() => target.classList.add('opacity-10'), 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.classList.remove('opacity-10');
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedItemId && draggedItemId !== id) {
      const draggedItem = items.find(i => i.id === draggedItemId);
      const targetItem = items.find(i => i.id === id);
      if (draggedItem && targetItem && draggedItem.section === targetItem.section) {
        setDragOverItemId(id);
        onMoveItem(draggedItemId, id);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverItemId(null);
  };

  const handleMoveDirection = (id: string, direction: 'up' | 'down') => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const sameSectionItems = items.filter(i => i.section === item.section);
    const currentIndex = sameSectionItems.findIndex(i => i.id === id);
    if (direction === 'up' && currentIndex > 0) {
      const targetItem = sameSectionItems[currentIndex - 1];
      onMoveItem(item.id, targetItem.id);
    } else if (direction === 'down' && currentIndex < sameSectionItems.length - 1) {
      const targetItem = sameSectionItems[currentIndex + 1];
      onMoveItem(item.id, targetItem.id);
    }
  };

  const renderMobileSection = (sectionItems: QuoteLineItem[], sectionLabel: string) => {
    if (sectionItems.length === 0) return null;
    const langSectionLabel = showChinese ? (sectionLabel === 'Property' ? '墓地選擇' : '服務及項目') : sectionLabel;

    return (
      <div className="space-y-3">
        <div className="bg-slate-100 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 flex justify-between items-center">
          <span>{langSectionLabel}</span>
          <span className="text-slate-400 font-bold">{sectionItems.length} {showChinese ? '項' : 'items'}</span>
        </div>
        {sectionItems.map((item, index) => (
          <div 
            key={item.id} 
            className={`bg-white rounded-2xl p-4 border transition-all duration-200 shadow-sm ${item.isWaived ? 'bg-emerald-50/20 border-emerald-200' : 'border-slate-200'}`}
          >
            {/* Header: Title + Delete */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1">
                <div className={`font-bold text-sm leading-snug ${item.isWaived ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                  {showChinese ? (item.chineseName || item.name) : item.name}
                </div>
                <div className="text-[10px] text-slate-400 font-bold mt-0.5 uppercase tracking-wider">
                  ${formatCurrency(item.unitPrice)} / {showChinese ? '單價' : 'unit'}
                </div>
              </div>
              <button 
                onClick={() => onRemove(item.id)}
                className="w-10 h-10 rounded-xl bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center shrink-0 active:scale-95 transition-all"
                aria-label="Remove item"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>

            {/* Stepper and Total Price */}
            <div className="flex items-center justify-between py-2 border-y border-slate-100">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => onUpdateQty(item.id, Math.max(1, item.quantity - 1))} 
                  className="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center font-black text-slate-700 text-lg active:bg-slate-200 transition-colors"
                >
                  -
                </button>
                <span className="w-8 text-center font-black text-base text-slate-900">{item.quantity}</span>
                <button 
                  onClick={() => onUpdateQty(item.id, item.quantity + 1)} 
                  className="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center font-black text-slate-700 text-lg active:bg-slate-200 transition-colors"
                >
                  +
                </button>
              </div>
              <div className="text-right">
                {item.isWaived ? (
                  <div>
                    <span className="line-through text-slate-400 text-xs mr-1.5">${formatCurrency(item.total)}</span>
                    <span className="text-sm font-black text-emerald-600 block">{showChinese ? '已減免' : 'WAIVED'}</span>
                  </div>
                ) : (
                  <span className="text-base font-black text-slate-900">${formatCurrency(item.total)}</span>
                )}
              </div>
            </div>

            {/* Tax & Discount Toggles (Touch-friendly chips) */}
            <div className="pt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => onUpdateTaxes(item.id, !item.isGSTApplicable, item.isPSTApplicable)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${item.isGSTApplicable ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}
                >
                  GST {item.isGSTApplicable ? '✓' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateTaxes(item.id, item.isGSTApplicable, !item.isPSTApplicable)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${item.isPSTApplicable ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}
                >
                  PST {item.isPSTApplicable ? '✓' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateDiscountable(item.id, !item.isDiscountable)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${!item.isDiscountable ? 'bg-amber-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}
                >
                  {showChinese ? '不可折' : 'Non-Disc'} {!item.isDiscountable ? '✓' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateWaived?.(item.id, !item.isWaived)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${item.isWaived ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}
                >
                  {showChinese ? '減免' : 'Waive'} {item.isWaived ? '✓' : ''}
                </button>
              </div>

              {/* Order Steppers */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleMoveDirection(item.id, 'up')}
                  disabled={index === 0}
                  className={`w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center transition-colors ${index === 0 ? 'text-slate-300 opacity-40' : 'text-slate-600 active:bg-slate-100'}`}
                  title="Move up"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7"/></svg>
                </button>
                <button
                  onClick={() => handleMoveDirection(item.id, 'down')}
                  disabled={index === sectionItems.length - 1}
                  className={`w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center transition-colors ${index === sectionItems.length - 1 ? 'text-slate-300 opacity-40' : 'text-slate-600 active:bg-slate-100'}`}
                  title="Move down"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"/></svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderRows = (sectionItems: QuoteLineItem[], sectionLabel: string) => {
    if (sectionItems.length === 0) return null;
    
    // STRICT language label for sections
    const langSectionLabel = showChinese ? (sectionLabel === 'Property' ? '墓地選擇' : '服務及項目') : sectionLabel;

    return (
      <>
        <tr className="bg-slate-100/50"><td colSpan={9} className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 border-y border-slate-200">{langSectionLabel}</td></tr>
        {sectionItems.map((item) => (
          <tr 
            key={item.id} 
            draggable 
            onDragStart={(e) => handleDragStart(e, item.id)}
            onDragOver={(e) => handleDragOver(e, item.id)}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            className={`transition-all duration-150 border-l-4 ${item.isWaived ? 'bg-emerald-50/20 opacity-80' : ''} ${draggedItemId === item.id ? 'bg-blue-50/30 border-blue-400' : 'border-transparent hover:bg-slate-50'} ${dragOverItemId === item.id ? 'border-blue-300' : ''} cursor-default group select-none`}
          >
            <td className="px-6 py-4">
              <div className="flex items-center gap-4">
                <div className="cursor-grab text-slate-300 group-hover:text-slate-500 transition-colors shrink-0 p-1"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M7 7h2v2H7V7zm0 4h2v2H7v-2zm4-4h2v2h-2V7zm0 4h2v2h-2v-2zM7 3h2v2H7V3zm4 0h2v2h-2V3zm-4 12h2v2H7v-2zm4 0h2v2h-2v-2z"/></svg></div>
                <div className="flex flex-col">
                   <div className={`font-bold text-sm ${item.isWaived ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                     {/* EXACTLY show either Chinese or English, no fallback mixing */}
                     {showChinese ? (item.chineseName || '') : item.name}
                   </div>
                </div>
              </div>
            </td>
            <td className="px-4 py-4">
              <div className="flex items-center justify-center gap-2" onDragStart={(e) => e.stopPropagation()}>
                <button onClick={() => onUpdateQty(item.id, Math.max(1, item.quantity - 1))} className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center hover:bg-white active:bg-slate-100 text-sm">-</button>
                <span className="w-6 text-center font-medium text-sm">{item.quantity}</span>
                <button onClick={() => onUpdateQty(item.id, item.quantity + 1)} className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center hover:bg-white active:bg-slate-100 text-sm">+</button>
              </div>
            </td>
            <td className="px-4 py-4 text-center"><input type="checkbox" checked={item.isGSTApplicable} onChange={(e) => onUpdateTaxes(item.id, e.target.checked, item.isPSTApplicable)} className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer" /></td>
            <td className="px-4 py-4 text-center"><input type="checkbox" checked={item.isPSTApplicable} onChange={(e) => onUpdateTaxes(item.id, item.isGSTApplicable, e.target.checked)} className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer" /></td>
            <td className="px-4 py-4 text-center"><input type="checkbox" checked={!item.isDiscountable} onChange={(e) => onUpdateDiscountable(item.id, !e.target.checked)} className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer" /></td>
            <td className="px-4 py-4 text-center"><input type="checkbox" checked={!!item.isWaived} onChange={(e) => onUpdateWaived?.(item.id, e.target.checked)} className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer" /></td>
            <td className="px-6 py-4 text-right text-slate-600 font-mono text-sm">${formatCurrency(item.unitPrice)}</td>
            <td className="px-6 py-4 text-right font-bold font-mono text-sm">
              {item.isWaived ? (
                <span className="text-emerald-600 font-medium">
                  <span className="line-through text-slate-400 font-normal mr-1">${formatCurrency(item.total)}</span>
                  <span className="text-[10px] font-bold text-emerald-600 uppercase">({showChinese ? '已減免' : 'WAIVED'})</span>
                </span>
              ) : (
                <span className="text-slate-900">${formatCurrency(item.total)}</span>
              )}
            </td>
            <td className="px-6 py-4 text-right"><button onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-red-600 transition-colors p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button></td>
          </tr>
        ))}
      </>
    );
  };

  return (
    <>
      {/* Mobile Touch Cards View */}
      <div className="block md:hidden space-y-4">
        {renderMobileSection(propertyItems, "Property")}
        {renderMobileSection(msItems, "Merchandise and Services")}
      </div>

      {/* Desktop Full Table View */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider">
              <th className="px-6 py-4">{showChinese ? '描述' : 'Description'}</th>
              <th className="px-4 py-4 text-center">{showChinese ? '數量' : 'Qty'}</th>
              <th className="px-4 py-4 text-center">GST</th>
              <th className="px-4 py-4 text-center">PST</th>
              <th className="px-4 py-4 text-center">Non-Disc</th>
              <th className="px-4 py-4 text-center">{showChinese ? '減免' : 'Waive'}</th>
              <th className="px-6 py-4 text-right">{showChinese ? '單價' : 'Unit Price'}</th>
              <th className="px-6 py-4 text-right">{showChinese ? '總額' : 'Total'}</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{renderRows(propertyItems, "Property")}{renderRows(msItems, "Merchandise and Services")}</tbody>
        </table>
      </div>
    </>
  );
};

export default QuoteTable;