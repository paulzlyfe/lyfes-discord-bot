import { useState, useEffect, useCallback } from 'react';

export interface StreakData {
  currentStreak: number;
  bestStreak: number;
  totalJobsCompleted: number;
  sessionJobsCompleted: number;
  lastJob: string;
  lastJobName: string;
  streakHistory: Array<{ streak: number; timestamp: number; job: string }>;
}

export interface GameState {
  job: string;
  job_name: string;
  job_title: string;
  subjob: string;
  subjob_name: string;
  wallet: number;
  bank: number;
  name: string;
  user_id: number;
  notification: string;
  vehicle: string;
  vehicleName: string;
  health: number;
  zone: string;
  zoneName: string;
  street: string;
}

const LOCAL_STORAGE_KEY = 'tt_streak_data';

const defaultStreakData: StreakData = {
  currentStreak: 0,
  bestStreak: 0,
  totalJobsCompleted: 0,
  sessionJobsCompleted: 0,
  lastJob: '',
  lastJobName: '',
  streakHistory: [],
};

const defaultGameState: GameState = {
  job: '',
  job_name: '',
  job_title: '',
  subjob: '',
  subjob_name: '',
  wallet: 0,
  bank: 0,
  name: '',
  user_id: 0,
  notification: '',
  vehicle: '',
  vehicleName: '',
  health: 100,
  zone: '',
  zoneName: '',
  street: '',
};

export function useFivemStreaks() {
  const [streakData, setStreakData] = useState<StreakData>(() => {
    try {
      const item = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (item) {
        const parsed = JSON.parse(item);
        return { ...defaultStreakData, ...parsed, sessionJobsCompleted: 0 };
      }
    } catch (e) {
      console.error("Error loading streak data", e);
    }
    return defaultStreakData;
  });

  const [gameState, setGameState] = useState<GameState>(defaultGameState);
  const [milestone, setMilestone] = useState<number | null>(null);

  const resetStreak = useCallback(() => {
    setStreakData((prev) => {
      const newHistory = prev.currentStreak > 0
        ? [{ streak: prev.currentStreak, timestamp: Date.now(), job: prev.lastJobName || prev.lastJob }, ...prev.streakHistory].slice(0, 10)
        : prev.streakHistory;

      const newData = {
        ...prev,
        currentStreak: 0,
        streakHistory: newHistory
      };
      
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newData));
      return newData;
    });
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;

      setGameState(prev => {
        const newState = { ...prev };
        let stateChanged = false;
        
        for (const key of Object.keys(data)) {
          if (key in defaultGameState && typeof data[key] !== 'undefined') {
            (newState as any)[key] = data[key];
            stateChanged = true;
          }
        }

        const isTransportJob = newState.job && !['unemployed', 'police', 'ambulance', 'mechanic'].includes(newState.job);
        
        if (newState.health < 10 || newState.job === 'unemployed' || newState.job === '') {
          resetStreak();
        }

        let incrementStreak = false;

        for (const key of Object.keys(data)) {
          if (key.startsWith('trigger_')) {
            if (key === 'trigger_job_fail' || key === 'trigger_death') {
              resetStreak();
            } else if (isTransportJob && data[key]) {
               incrementStreak = true;
            }
          }
        }

        if (data.notification && data.notification !== prev.notification) {
          const lowerNotification = data.notification.toLowerCase();
          const matchWords = ["earned", "paid", "delivery", "completed", "job done", "task complete", "reward", "wage", "salary"];
          if (matchWords.some(w => lowerNotification.includes(w)) && isTransportJob) {
            incrementStreak = true;
          }
        }

        if (incrementStreak) {
          setStreakData(prevStreak => {
            const newStreak = prevStreak.currentStreak + 1;
            const newBest = newStreak > prevStreak.bestStreak ? newStreak : prevStreak.bestStreak;
            
            if ([5, 10, 25, 50, 100, 200].includes(newStreak)) {
              window.parent.postMessage({ type: "notification", text: `Transport Tycoon: ${newStreak} job streak!` }, '*');
              
              let sfx = 2;
              if (newStreak >= 50) sfx = 16;
              else if (newStreak >= 10) sfx = 5;
              
              window.parent.postMessage({ type: "sfx", sfx }, '*');
              setMilestone(newStreak);
              setTimeout(() => setMilestone(null), 2000);
            }

            const newData = {
              ...prevStreak,
              currentStreak: newStreak,
              bestStreak: newBest,
              totalJobsCompleted: prevStreak.totalJobsCompleted + 1,
              sessionJobsCompleted: prevStreak.sessionJobsCompleted + 1,
              lastJob: newState.job,
              lastJobName: newState.job_name || newState.job,
            };
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newData));
            return newData;
          });
        }

        return stateChanged ? newState : prev;
      });
    };

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: "getData" }, '*');

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [resetStreak]);

  const manualReset = useCallback(() => {
    resetStreak();
  }, [resetStreak]);

  return { streakData, gameState, milestone, manualReset };
}