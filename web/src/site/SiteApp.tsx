import { Route, Routes } from 'react-router-dom';
import { CartProvider } from './CartContext';
import MenuPage from './MenuPage';
import CheckoutPage from './CheckoutPage';
import TrackingPage from './TrackingPage';
import CartSheet from './CartSheet';

export default function SiteApp() {
  return (
    <CartProvider>
      <Routes>
        <Route index element={<MenuPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="pedido/:code" element={<TrackingPage />} />
        <Route path="*" element={<MenuPage />} />
      </Routes>
      <CartSheet />
    </CartProvider>
  );
}
