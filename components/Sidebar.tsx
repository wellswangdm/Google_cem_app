import React, { useState } from 'react';
import { SheetSource, BusinessInfo } from '../types';

interface SidebarProps {
  sources: SheetSource[];
  activeView: 'builder' | 'history' | 'sheets' | 'compare';
  setActiveView: (view: 'builder' | 'history' | 'sheets' | 'compare') => void;
  onAddSheet: () => void;
  onDeleteSheet: (id: string) => void;
  onEditSheetName: (id: string, newName: string) => void;
  isSyncing: boolean;
  isVisible: boolean;
  onClose?: () => void;
  // User Profile Props
  businessProfile: BusinessInfo;
  setBusinessProfile: (info: BusinessInfo) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  sources, 
  activeView, 
  setActiveView, 
  onAddSheet, 
  onDeleteSheet, 
  onEditSheetName, 
  isSyncing, 
  isVisible,
  onClose,
  businessProfile,
  setBusinessProfile
}) => {
  const [showProfile, setShowProfile] = useState(false);

  const handleNav = (view: 'builder' | 'history' | 'sheets' | 'compare') => {
    setActiveView(view);
    if (onClose) onClose();
  };

  return (
    <>
      {isVisible && (
        <div 
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div className={`w-72 md:w-64 h-screen bg-slate-900 text-slate-300 flex flex-col fixed left-0 top-0 z-50 md:z-20 print:hidden shadow-2xl transition-transform duration-300 ease-in-out ${isVisible ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white font-black text-xl tracking-tight">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-sm">WI</span>
            </div>
            Wells Inc.
          </div>
          <button 
            onClick={onClose}
            className="md:hidden p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 active:scale-95 transition-all"
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
        {/* ORGANIZATION PROFILE SECTION */}
        <div className="mb-6 px-2">
          <button 
            onClick={() => setShowProfile(!showProfile)}
            className="w-full flex items-center justify-between text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3 hover:text-slate-300 transition-colors"
          >
            Organization Profile
            <svg className={`w-3 h-3 transition-transform ${showProfile ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </button>
          
          {showProfile && (
            <div className="space-y-3 bg-slate-800/30 p-4 rounded-2xl border border-slate-800 animate-in fade-in slide-in-from-top-2">
               <div className="space-y-1">
                 <label className="text-[8px] font-black text-slate-500 uppercase ml-1">Business Name</label>
                 <input 
                  type="text" 
                  value={businessProfile.name} 
                  onChange={(e) => setBusinessProfile({ ...businessProfile, name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none"
                 />
               </div>
               <div className="space-y-1">
                 <label className="text-[8px] font-black text-slate-500 uppercase ml-1">Address</label>
                 <textarea 
                  rows={2}
                  value={businessProfile.address} 
                  onChange={(e) => setBusinessProfile({ ...businessProfile, address: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                 />
               </div>
               <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-500 uppercase ml-1">Email</label>
                    <input 
                      type="text" 
                      value={businessProfile.email} 
                      onChange={(e) => setBusinessProfile({ ...businessProfile, email: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-white focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-500 uppercase ml-1">Phone</label>
                    <input 
                      type="text" 
                      value={businessProfile.phone} 
                      onChange={(e) => setBusinessProfile({ ...businessProfile, phone: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-white focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
               </div>
               <p className="text-[8px] text-slate-600 italic text-center mt-1">Updates all future quotes on this device.</p>
            </div>
          )}
        </div>

        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 px-2">Navigation</div>
        
        <button 
          onClick={() => handleNav('builder')}
          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all duration-200 ${activeView === 'builder' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 translate-x-1' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
          <span className="font-semibold">Quote Builder</span>
        </button>
        <button 
          onClick={() => handleNav('history')}
          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all duration-200 ${activeView === 'history' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 translate-x-1' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
          <span className="font-semibold">Templates</span>
        </button>
        <button 
          onClick={() => handleNav('compare')}
          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all duration-200 ${activeView === 'compare' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 translate-x-1' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          <span className="font-semibold">Comparison Tool</span>
        </button>
        <button 
          onClick={() => handleNav('sheets')}
          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all duration-200 ${activeView === 'sheets' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 translate-x-1' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
          <span className="font-semibold">Data Sources</span>
        </button>

        <div className="pt-8 px-2">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex justify-between items-center">
            Active Sheets
            {isSyncing && <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>}
          </div>
          <div className="space-y-3">
            {sources.length === 0 && (
              <p className="text-slate-600 text-xs italic px-2">No sheets uploaded.</p>
            )}
            {sources.map(s => (
              <div key={s.id} className="group relative bg-slate-800/40 p-3 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-all hover:bg-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${s.section === 'Property' ? 'bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]' : 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]'}`}></div>
                    <span className="truncate text-slate-200 text-xs font-bold group-hover:text-white">{s.name}</span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDeleteSheet(s.id); }}
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                    title="Delete source"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-slate-500 uppercase font-black tracking-wider leading-none">{s.section === 'Property' ? 'Property' : 'M&S'}</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const newName = prompt("Enter new name for sheet:", s.name);
                      if (newName && newName.trim()) onEditSheetName(s.id, newName);
                    }}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                    Rename
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </nav>

      <div className="p-4 border-t border-slate-800">
        <button 
          onClick={() => {
            onAddSheet();
            if (onClose) onClose();
          }}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl shadow-xl shadow-blue-600/10 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
          Add New Sheet
        </button>
      </div>
    </div>
    </>
  );
};

export default Sidebar;