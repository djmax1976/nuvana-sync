/**
 * New Game Modal Component
 * Modal for creating a new lottery game when an unknown game code is encountered
 * during pack reception.
 *
 * Features:
 * - Auto-uppercase game name input
 * - Displays the game code from the scanned serial
 * - Creates game and allows pack reception to continue
 * - Enterprise-grade dropdown selections for price and pack_value
 * - Dynamic total_tickets calculation display
 *
 * Story: 6.x - Lottery Configuration Values Enhancement
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle } from 'lucide-react';
import { createGame, getLotteryConfigValues, type LotteryConfigValueItem } from '@/lib/api/lottery';

interface GameToCreate {
  serial: string;
  game_code: string;
  pack_number: string;
  serial_start: string;
  price?: number;
}

interface NewGameModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gamesToCreate: GameToCreate[];
  storeId: string;
  onGamesCreated: (
    createdGameCodes: string[],
    createdGames: Map<
      string,
      { name: string; price: number; pack_value: number; total_tickets: number }
    >
  ) => void;
  onCancel: () => void;
}

/**
 * NewGameModal component
 * Prompts user to enter game names for unknown game codes
 */
export function NewGameModal({
  open,
  onOpenChange,
  gamesToCreate,
  storeId,
  onGamesCreated,
  onCancel,
}: NewGameModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [gameName, setGameName] = useState('');
  const [selectedPrice, setSelectedPrice] = useState<string>('');
  const [selectedPackValue, setSelectedPackValue] = useState<string>('');
  const [createdGameCodes, setCreatedGameCodes] = useState<string[]>([]);
  const [createdGames, setCreatedGames] = useState<
    Map<string, { name: string; price: number; pack_value: number; total_tickets: number }>
  >(new Map());

  // Configuration values from API
  const [ticketPrices, setTicketPrices] = useState<LotteryConfigValueItem[]>([]);
  const [packValues, setPackValues] = useState<LotteryConfigValueItem[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Get unique game codes (multiple packs might have same game code)
  const uniqueGameCodes = Array.from(new Map(gamesToCreate.map((g) => [g.game_code, g])).values());

  // eslint-disable-next-line security/detect-object-injection -- currentIndex is a controlled state variable bounded by array length
  const currentGame = uniqueGameCodes[currentIndex];
  const totalGames = uniqueGameCodes.length;
  const isLastGame = currentIndex === totalGames - 1;

  // Fetch configuration values when modal opens
  useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setGameName('');
      setSelectedPrice('');
      setSelectedPackValue('');
      setCreatedGameCodes([]);
      setCreatedGames(new Map());
      setConfigError(null);

      // Fetch config values from API
      const fetchConfigValues = async () => {
        setIsLoadingConfig(true);
        try {
          const response = await getLotteryConfigValues();
          if (response.success && response.data) {
            setTicketPrices(response.data.ticket_prices);
            setPackValues(response.data.pack_values);
          } else {
            throw new Error('Failed to load configuration values');
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load configuration values';
          setConfigError(errorMessage);
          toast({
            title: 'Configuration Error',
            description: errorMessage,
            variant: 'destructive',
          });
        } finally {
          setIsLoadingConfig(false);
        }
      };

      fetchConfigValues();
    }
  }, [open, toast]);

  // Calculate total tickets based on selected price and pack value
  const calculatedTotalTickets = useMemo(() => {
    const price = parseFloat(selectedPrice);
    const packValue = parseFloat(selectedPackValue);
    if (price > 0 && packValue > 0 && packValue % price === 0) {
      return packValue / price;
    }
    return null;
  }, [selectedPrice, selectedPackValue]);

  // Check if pack_value is divisible by price (whole number of tickets)
  const isDivisible = useMemo(() => {
    const price = parseFloat(selectedPrice);
    const packValue = parseFloat(selectedPackValue);
    if (price > 0 && packValue > 0) {
      return packValue % price === 0;
    }
    return true; // No error state when values not selected
  }, [selectedPrice, selectedPackValue]);

  // Handle game name input with auto-uppercase
  const handleGameNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setGameName(e.target.value.toUpperCase());
  }, []);

  // Handle price dropdown selection
  const handlePriceChange = useCallback((value: string) => {
    setSelectedPrice(value);
  }, []);

  // Handle pack value dropdown selection
  const handlePackValueChange = useCallback((value: string) => {
    setSelectedPackValue(value);
  }, []);

  // Handle creating the current game
  const handleCreateGame = useCallback(async () => {
    if (!currentGame || !gameName.trim()) {
      toast({
        title: 'Error',
        description: 'Game name is required',
        variant: 'destructive',
      });
      return;
    }

    const price = parseFloat(selectedPrice);
    const packValue = parseFloat(selectedPackValue);

    if (!selectedPrice || price <= 0) {
      toast({
        title: 'Error',
        description: 'Please select a ticket price',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedPackValue || packValue <= 0) {
      toast({
        title: 'Error',
        description: 'Please select a pack value',
        variant: 'destructive',
      });
      return;
    }

    if (!isDivisible) {
      toast({
        title: 'Error',
        description:
          'Pack value must be evenly divisible by ticket price (whole number of tickets)',
        variant: 'destructive',
      });
      return;
    }

    const totalTickets = packValue / price;

    setIsSubmitting(true);
    try {
      const response = await createGame({
        game_code: currentGame.game_code,
        name: gameName.trim(),
        price: price,
        pack_value: packValue,
        store_id: storeId,
      });

      if (response.success) {
        const newCreatedCodes = [...createdGameCodes, currentGame.game_code];
        setCreatedGameCodes(newCreatedCodes);

        // Track the created game with its data
        const newCreatedGames = new Map(createdGames);
        newCreatedGames.set(currentGame.game_code, {
          name: gameName.trim(),
          price,
          pack_value: packValue,
          total_tickets: totalTickets,
        });
        setCreatedGames(newCreatedGames);

        toast({
          title: 'Game created',
          description: `Game "${gameName.trim()}" (${currentGame.game_code}) - $${price.toFixed(2)} ticket / $${packValue.toFixed(2)} pack (${totalTickets} tickets) created successfully`,
        });

        if (isLastGame) {
          // All games created, notify parent with game data
          onGamesCreated(newCreatedCodes, newCreatedGames);
          onOpenChange(false);
        } else {
          // Move to next game
          setCurrentIndex((prev) => prev + 1);
          setGameName('');
          setSelectedPrice('');
          setSelectedPackValue('');
        }
      } else {
        throw new Error('Failed to create game');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create game';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    currentGame,
    gameName,
    selectedPrice,
    selectedPackValue,
    isDivisible,
    isLastGame,
    createdGameCodes,
    createdGames,
    storeId,
    toast,
    onGamesCreated,
    onOpenChange,
  ]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onCancel();
    onOpenChange(false);
  }, [onCancel, onOpenChange]);

  // Handle key press for Enter submission
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        e.key === 'Enter' &&
        gameName.trim() &&
        selectedPrice &&
        selectedPackValue &&
        isDivisible &&
        !isSubmitting
      ) {
        e.preventDefault();
        handleCreateGame();
      }
    },
    [gameName, selectedPrice, selectedPackValue, isDivisible, isSubmitting, handleCreateGame]
  );

  if (!currentGame) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>New Game Found</DialogTitle>
          <DialogDescription>
            {totalGames > 1 ? `Game ${currentIndex + 1} of ${totalGames}: ` : ''}
            The game code <strong>{currentGame.game_code}</strong> was not found in the database.
            Please enter a name for this game to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Configuration Loading/Error State */}
          {isLoadingConfig && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading configuration...</span>
            </div>
          )}

          {configError && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{configError}</span>
            </div>
          )}

          {!isLoadingConfig && !configError && (
            <>
              {/* Game Code Display */}
              <div className="space-y-2">
                <Label className="text-muted-foreground">Game Code</Label>
                <div className="text-lg font-mono font-semibold">{currentGame.game_code}</div>
              </div>

              {/* Game Name Input */}
              <div className="space-y-2">
                <Label htmlFor="game-name">
                  Game Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="game-name"
                  value={gameName}
                  onChange={handleGameNameChange}
                  onKeyDown={handleKeyDown}
                  placeholder="MEGA MILLIONS"
                  disabled={isSubmitting}
                  maxLength={255}
                  className="uppercase"
                  autoFocus
                  data-testid="new-game-name-input"
                />
                <p className="text-xs text-muted-foreground">
                  Enter the official lottery game name (auto-uppercase)
                </p>
              </div>

              {/* Ticket Price Dropdown */}
              <div className="space-y-2">
                <Label htmlFor="game-price">
                  Ticket Price <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={selectedPrice}
                  onValueChange={handlePriceChange}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="game-price" data-testid="new-game-price-select">
                    <SelectValue placeholder="Select ticket price" />
                  </SelectTrigger>
                  <SelectContent>
                    {ticketPrices.map((item) => (
                      <SelectItem key={item.config_value_id} value={item.amount.toString()}>
                        ${item.amount.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Select the price per lottery ticket</p>
              </div>

              {/* Pack Value Dropdown */}
              <div className="space-y-2">
                <Label htmlFor="game-pack-value">
                  Pack Value <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={selectedPackValue}
                  onValueChange={handlePackValueChange}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="game-pack-value" data-testid="new-game-pack-value-select">
                    <SelectValue placeholder="Select pack value" />
                  </SelectTrigger>
                  <SelectContent>
                    {packValues.map((item) => (
                      <SelectItem key={item.config_value_id} value={item.amount.toString()}>
                        ${item.amount.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Select the total dollar value per pack
                </p>
              </div>

              {/* Divisibility Error */}
              {selectedPrice && selectedPackValue && !isDivisible && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">
                    Pack value must be evenly divisible by ticket price
                  </span>
                </div>
              )}

              {/* Calculated Total Tickets Display */}
              {calculatedTotalTickets !== null && (
                <div className="bg-primary/10 p-3 rounded-md">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Total Tickets:</span>
                    <span className="text-lg font-bold text-primary">{calculatedTotalTickets}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Serial numbers: 0 to {calculatedTotalTickets - 1}
                  </p>
                </div>
              )}

              {/* Pack Info */}
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                <strong>Pack Number:</strong> {currentGame.pack_number}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            Cancel Reception
          </Button>
          <Button
            type="button"
            onClick={handleCreateGame}
            disabled={
              isSubmitting ||
              isLoadingConfig ||
              !!configError ||
              !gameName.trim() ||
              !selectedPrice ||
              !selectedPackValue ||
              !isDivisible
            }
            data-testid="create-game-button"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLastGame ? 'Create & Receive Packs' : 'Create & Next'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
