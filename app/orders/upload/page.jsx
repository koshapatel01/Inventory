import Link from 'next/link';
import InvoiceUpload from '@/components/InvoiceUpload';

export default function UploadInvoicePage() {
  return (
    <main className="container">
      <header className="app-header">
        <h1>Upload Invoice / PO</h1>
        <p className="subtitle"><Link href="/orders">← Back to order history</Link></p>
      </header>

      <InvoiceUpload />
    </main>
  );
}
