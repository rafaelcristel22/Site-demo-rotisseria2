import { Beef, CakeSlice, CupSoda, Drumstick, Layers, Package, Salad, Soup, UtensilsCrossed, Wheat } from 'lucide-react';

const THEMES: Record<string, { from: string; to: string; Icon: typeof Beef }> = {
  frangos: { from: '#f59e0b', to: '#b45309', Icon: Drumstick },
  marmitas: { from: '#ea580c', to: '#7c2d12', Icon: Package },
  carnes: { from: '#dc2626', to: '#7f1d1d', Icon: Beef },
  massas: { from: '#eab308', to: '#a16207', Icon: Wheat },
  lasanhas: { from: '#f97316', to: '#9a3412', Icon: Layers },
  acompanhamentos: { from: '#d97706', to: '#78350f', Icon: Soup },
  saladas: { from: '#65a30d', to: '#365314', Icon: Salad },
  sobremesas: { from: '#db2777', to: '#831843', Icon: CakeSlice },
  bebidas: { from: '#0891b2', to: '#164e63', Icon: CupSoda },
  combos: { from: '#ea5f06', to: '#431505', Icon: UtensilsCrossed },
};

/** Foto do produto ou, na falta dela, uma arte ilustrada pela categoria. */
export default function FoodArt({ src, slug, alt, className = '', iconSize = 40 }: {
  src?: string | null; slug?: string; alt: string; className?: string; iconSize?: number;
}) {
  const t = THEMES[slug ?? ''] ?? THEMES.combos;
  if (src) {
    return <img src={src} alt={alt} loading="lazy" className={`object-cover ${className}`}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />;
  }
  const { Icon } = t;
  return (
    <div role="img" aria-label={alt} className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ background: `radial-gradient(120% 90% at 30% 20%, ${t.from}, ${t.to})` }}>
      <div className="grain absolute inset-0 opacity-60" />
      <div className="absolute -right-6 -bottom-6 h-24 w-24 rounded-full bg-white/10" />
      <div className="absolute -left-4 -top-8 h-20 w-20 rounded-full bg-black/10" />
      <Icon size={iconSize} strokeWidth={1.6} className="relative text-white/90 drop-shadow" />
    </div>
  );
}
