import "./globals.css";

export const metadata = {
  title: "Gun-ob PWD Registry",
  description: "PWD member registry and annual payment status for Barangay Gun-ob.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}