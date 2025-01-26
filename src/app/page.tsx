import Image from "next/image";
import styles from "./_styles/page.module.css";
import LandingPage from "./_components/LandingPage";

export default function Home() {
  return (
    <div className={styles.page}>
      <LandingPage />
    </div>
  );
}
