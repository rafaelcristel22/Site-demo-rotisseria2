export interface MenuOption { id: string; name: string; price_delta: number }
export interface MenuOptionGroup { id: string; name: string; min_select: number; max_select: number; options: MenuOption[] }
export interface MenuProduct {
  id: string; category_id: string; name: string; description: string | null; image_url: string | null;
  price: number; list_price: number; promotion: string | null; product_type: string; unit: string;
  serves: number | null; tags: string[]; is_featured: boolean; is_popular: boolean; sold_out: boolean;
  prep_time_minutes: number; combo_items: { name: string; quantity: number }[]; option_groups: MenuOptionGroup[];
}
export interface MenuCategory { id: string; name: string; slug: string; description: string | null; image_url: string | null }
export interface DeliveryZone { id: string; district: string; city: string; fee: number; min_order_value: number; free_delivery_above: number | null; estimated_minutes: number }
export interface PaymentMethodPublic { code: string; name: string; method_type: string; allows_change: boolean }
export interface CompanyPublic {
  trade_name: string; phone: string | null; whatsapp: string | null; address: Record<string, string>; logo_url: string | null;
  primary_color: string; opening_hours: Record<string, { open: string; close: string; closed: boolean }>;
  online_ordering_enabled: boolean; delivery_enabled: boolean; pickup_enabled: boolean; scheduling_enabled: boolean;
  scheduling_max_days: number; min_order_value: number; avg_prep_minutes: number; loyalty_enabled: boolean;
  privacy_policy_text: string | null; privacy_policy_url: string | null; is_open_now: boolean; timezone: string;
}
export interface PublicMenu {
  company: CompanyPublic; categories: MenuCategory[]; products: MenuProduct[];
  banners: { id: string; title: string; subtitle: string | null; image_url: string | null; link_url: string | null; product_id: string | null }[];
  delivery_zones: DeliveryZone[]; payment_methods: PaymentMethodPublic[];
}
