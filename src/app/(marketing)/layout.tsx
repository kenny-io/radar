// Public marketing site (UPDATE-2026-10-25 §5–§6): rendered outside AppProvider and the app shell. Its CSS is scoped under .mk.
import '@/features/marketing/marketing.css';

export default function MarketingLayout({ children }: { children: React.ReactNode }) { return children; }
