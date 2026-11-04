import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Asyl As — голос учеников',description:'Оставь отзыв о школьном обеде или выбери блюдо по QR-коду. Без имени и регистрации.',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>;}
