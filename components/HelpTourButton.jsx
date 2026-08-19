'use client';

import { useTour } from '@/components/Guide';

// Lets the Help Center page trigger the same guided tour as the floating ?
// button, via the shared TourContext from components/Guide.jsx.
export default function HelpTourButton() {
  const { restartTour } = useTour();
  return (
    <button type="button" className="transfer-btn" onClick={restartTour}>
      ▶ Restart the guided tour
    </button>
  );
}
