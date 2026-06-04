import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, MapPin, Briefcase, Car, Trophy, Hash, Pin, RotateCcw, Timer } from 'lucide-react';
import { useFivemStreaks } from '@/hooks/useFivemStreaks';
import { Button } from '@/components/ui/button';

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function StreakHUD() {
  const { streakData, gameState, milestone, manualReset, timeUntilReset } = useFivemStreaks();
  const isWarning = timeUntilReset <= 60_000; // last 60 seconds
  const [confirmReset, setConfirmReset] = useState(false);
  const [justGotBest, setJustGotBest] = useState(false);
  const prevBest = useRef(streakData.bestStreak);

  useEffect(() => {
    if (streakData.bestStreak > prevBest.current && streakData.bestStreak > 0) {
      setJustGotBest(true);
      const timer = setTimeout(() => setJustGotBest(false), 2000);
      return () => clearTimeout(timer);
    }
    prevBest.current = streakData.bestStreak;
  }, [streakData.bestStreak]);

  const handlePin = () => {
    window.parent.postMessage({ type: "pin" }, '*');
  };

  const handleReset = () => {
    if (confirmReset) {
      manualReset();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
    }
  };

  return (
    <div className="relative w-full h-[100dvh] sm:w-[450px] bg-background/95 backdrop-blur-md border-r border-border text-foreground flex flex-col p-4 font-mono shadow-2xl overflow-hidden select-none">
      
      {/* Header */}
      <header className="flex items-center justify-between mb-6 pb-2 border-b border-border/50">
        <h1 className="text-sm font-black tracking-widest text-muted-foreground">TRANSPORT TYCOON</h1>
        <div className="flex items-center gap-3">
          <motion.div
            animate={isWarning ? { opacity: [1, 0.4, 1] } : {}}
            transition={{ duration: 0.8, repeat: Infinity }}
            className={`flex items-center gap-1 text-xs font-bold tabular-nums ${isWarning ? 'text-destructive' : 'text-muted-foreground'}`}
            data-testid="text-reset-countdown"
          >
            <Timer size={11} />
            {formatCountdown(timeUntilReset)}
          </motion.div>
          {gameState.name && (
            <div className="text-xs font-bold text-secondary">{gameState.name}</div>
          )}
        </div>
      </header>

      {/* Streak Counter */}
      <div className="flex-1 flex flex-col items-center justify-center space-y-2 mb-8">
        <div className="flex items-center space-x-2 text-primary font-bold tracking-widest text-sm">
          {streakData.currentStreak >= 10 && (
            <motion.span 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-primary text-primary-foreground px-2 py-0.5 rounded-sm text-[10px]"
              data-testid="badge-on-fire"
            >
              ON FIRE
            </motion.span>
          )}
          <span>CURRENT STREAK</span>
        </div>
        
        <div className="relative flex items-center justify-center">
          <motion.div
            key={streakData.currentStreak}
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 0.3 }}
            className="text-8xl font-black tabular-nums tracking-tighter text-foreground drop-shadow-[0_0_15px_rgba(249,115,22,0.3)]"
            data-testid="text-current-streak"
          >
            {streakData.currentStreak}
          </motion.div>
          {streakData.currentStreak > 0 && (
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -right-12 text-primary drop-shadow-[0_0_10px_rgba(249,115,22,0.8)]"
            >
              <Flame size={48} strokeWidth={2.5} />
            </motion.div>
          )}
        </div>

        <motion.div 
          animate={justGotBest ? { scale: [1, 1.1, 1], color: ["#fbbf24", "#fcd34d", "#fbbf24"] } : {}}
          className={`flex items-center space-x-1.5 text-xs font-bold px-3 py-1 rounded-full transition-colors duration-300 ${justGotBest ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50' : 'bg-muted/50 text-muted-foreground'}`}
          data-testid="text-best-streak"
        >
          <Trophy size={14} />
          <span>BEST: {streakData.bestStreak}</span>
        </motion.div>
      </div>

      {/* Job Info */}
      <div className="space-y-3 bg-card/40 border border-card-border rounded-lg p-4 mb-6">
        <div className="flex items-center text-sm font-bold text-secondary truncate">
          <Briefcase size={16} className="mr-2 shrink-0 opacity-80" />
          <span className="truncate" data-testid="text-job-name">
            {gameState.job_name || gameState.job || "No active job"} 
            {gameState.subjob_name ? ` - ${gameState.subjob_name}` : ""}
          </span>
        </div>
        
        {(gameState.zoneName || gameState.street) && (
          <div className="flex items-center text-xs text-muted-foreground truncate">
            <MapPin size={14} className="mr-2 shrink-0 opacity-70" />
            <span className="truncate" data-testid="text-location">
              {gameState.street}{gameState.street && gameState.zoneName ? ", " : ""}{gameState.zoneName}
            </span>
          </div>
        )}

        {gameState.vehicleName && (
          <div className="flex items-center text-xs text-muted-foreground truncate">
            <Car size={14} className="mr-2 shrink-0 opacity-70" />
            <span className="truncate" data-testid="text-vehicle">{gameState.vehicleName}</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-card/30 border border-card-border rounded-lg p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">Session Jobs</div>
          <div className="text-xl font-black text-foreground" data-testid="text-session-jobs">{streakData.sessionJobsCompleted}</div>
        </div>
        <div className="bg-card/30 border border-card-border rounded-lg p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">All Time Jobs</div>
          <div className="text-xl font-black text-foreground" data-testid="text-total-jobs">{streakData.totalJobsCompleted}</div>
        </div>
      </div>

      {/* Recent Streaks */}
      {streakData.streakHistory.length > 0 && (
        <div className="mb-6">
          <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2 flex items-center">
            <Hash size={12} className="mr-1" /> RECENT STREAKS
          </div>
          <div className="flex flex-wrap gap-2">
            {streakData.streakHistory.slice(0, 3).map((hist, i) => (
              <div key={i} className="bg-muted text-muted-foreground text-xs font-bold px-2.5 py-1 rounded-sm flex items-center" data-testid={`badge-recent-streak-${i}`}>
                x{hist.streak}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Controls */}
      <div className="mt-auto grid grid-cols-2 gap-3">
        <Button 
          variant="secondary" 
          onClick={handlePin}
          className="w-full font-bold tracking-wider border border-secondary/20"
          data-testid="button-pin"
        >
          <Pin className="mr-2 h-4 w-4" /> PIN
        </Button>
        <Button 
          variant={confirmReset ? "destructive" : "outline"}
          onClick={handleReset}
          className={`w-full font-bold tracking-wider transition-colors ${!confirmReset && 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
          data-testid="button-reset"
        >
          {confirmReset ? "CONFIRM RESET?" : <><RotateCcw className="mr-2 h-4 w-4" /> RESET</>}
        </Button>
      </div>

      {/* Milestone Popup */}
      <AnimatePresence>
        {milestone && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.5 }}
            className="absolute inset-0 z-50 pointer-events-none flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <motion.div 
              animate={{ rotate: [0, -5, 5, -5, 5, 0] }}
              transition={{ duration: 0.5 }}
              className="text-primary drop-shadow-[0_0_30px_rgba(249,115,22,1)]"
            >
              <Trophy size={80} />
            </motion.div>
            <h2 className="text-4xl font-black text-white mt-4 tracking-tighter drop-shadow-xl uppercase">
              MILESTONE
            </h2>
            <div className="text-7xl font-black text-primary drop-shadow-[0_0_20px_rgba(249,115,22,0.8)] mt-2">
              {milestone}
            </div>
            <div className="text-xl font-bold text-white/80 mt-2 tracking-widest">
              STREAK
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}