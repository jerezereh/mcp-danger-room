export interface ICrisisCardProps {
  name: string;
  type: string;
  image: string;
  crisisType: string;
  maxThreat: number;
  setup: string;
  scoring: string;
  rules: {
    [key: string]: string;
  };
}
