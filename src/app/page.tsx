import { redirect } from 'next/navigation';

/**
 * There is no landing page: the middleware already sends a signed-in visitor
 * to /dashboard, so anyone who reaches this needs the sign-in form.
 */
export default function Home() {
  redirect('/login');
}
