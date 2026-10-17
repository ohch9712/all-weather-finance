import { PageHeader } from "@/components/common/PageHeader";
import { BrokerConnectionsSection } from "@/features/market/components/BrokerConnectionsSection";

export default function ConnectionsPage() {
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="연결 관리" description="증권사 조회 연결과 시장 데이터 상태를 관리하세요." />
      <BrokerConnectionsSection allowMock={process.env.NODE_ENV === "development"} />
    </div>
  );
}
