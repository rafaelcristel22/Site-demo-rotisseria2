/** Foto do produto. Sem foto cadastrada, não desenha nada (o cardápio fica só em texto). */
export default function FoodArt({ src, alt, className = '' }: { src?: string | null; slug?: string; alt: string; className?: string; iconSize?: number }) {
  if (!src) return null;
  return <img src={src} alt={alt} loading="lazy" className={`object-cover ${className}`}
    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />;
}
