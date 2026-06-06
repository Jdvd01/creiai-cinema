import { RoomView } from "./room-view";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function RoomPage({ params }: Props) {
  const { code } = await params;
  return <RoomView code={code} />;
}
