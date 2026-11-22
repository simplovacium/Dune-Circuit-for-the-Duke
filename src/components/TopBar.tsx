import React from 'react';

export type HubTab = 'home' | 'garage' | 'tracks' | 'multiplayer' | 'leaderboards';

interface TopBarProps {
  activeTab: HubTab;
  onSelectTab: (tab: HubTab) => void;
  onQuickRace: () => void;
}

const NAV_ITEMS: { id: HubTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'garage', label: 'Garage' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'multiplayer', label: 'Multiplayer' },
  { id: 'leaderboards', label: 'Leaderboards' },
];

export const TopBar: React.FC<TopBarProps> = ({ activeTab, onSelectTab, onQuickRace }) => {
  return (
    <header className="relative z-20 flex items-center justify-between gap-8 px-6 py-4 bg-[#0b0d11]/92 border-b border-white/10">
      <button
        type="button"
        onClick={() => onSelectTab('home')}
        className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-500"
      >
        Dune Circuit for the Duke
      </button>

      <nav className="hidden md:flex items-center gap-7" aria-label="Primary Navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-500 ${
                isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute left-0 right-0 -bottom-[17px] h-[2px] bg-amber-500" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onQuickRace}
          className="px-5 py-2.5 text-sm font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
        >
          Quick Race
        </button>
      </div>
    </header>
  );
};
