import { FamilyApp } from "../../components/FamilyApp";
export const dynamic = "force-dynamic";
export default function FamilyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <FamilyApp
        hubEnabled={process.env.AMBERLY_CROKINOLE_ENABLED === "true"}
        gymEnabled={process.env.AMBERLY_GYM_LAB_ENABLED === "true"}
      />
      {children}
    </>
  );
}
