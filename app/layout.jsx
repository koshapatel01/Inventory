import './globals.css';

export const metadata = {
  title: 'UHD IT PMO — Supply Inventory',
  description: 'Supply inventory & purchasing-status tracker',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
