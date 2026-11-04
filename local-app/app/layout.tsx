import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"Asyl As — столовая без потерь",description:"Меньше пищевых отходов. Больше осознанности. Измерения, отзывы и исследование с Gemini.",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ru"><body>{children}</body></html>;}
