import './globals.css';
import GuideProvider from '@/components/Guide';

export const metadata = {
  title: 'UHD IT PMO — Supply Inventory',
  description: 'Supply inventory & purchasing-status tracker',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <GuideProvider>{children}</GuideProvider>
      </body>
    </html>
  );
}
