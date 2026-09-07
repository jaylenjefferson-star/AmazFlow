import "./styles.css";
import "./roles.css";
export const metadata = { title: "AmazFlow Control", description: "Configure and run operational workflows" };
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
