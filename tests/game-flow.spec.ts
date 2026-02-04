import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Integration tests for Fog of War Chess game flow.
 *
 * These tests validate that:
 * 1. White can create a game
 * 2. Black can join the game
 * 3. The chessboard UI renders correctly for both players
 */

test.describe('Game Flow Integration', () => {
  let whiteContext: BrowserContext;
  let blackContext: BrowserContext;
  let whitePage: Page;
  let blackPage: Page;

  // Shared game details between tests
  let gameId: string;
  const gamePassword = '12345';

  test.beforeAll(async ({ browser }) => {
    // Create separate browser contexts for each player
    // This simulates two different users/tabs with isolated storage
    whiteContext = await browser.newContext();
    blackContext = await browser.newContext();

    whitePage = await whiteContext.newPage();
    blackPage = await blackContext.newPage();

    // Enable console logging for debugging
    whitePage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[WHITE ERROR] ${msg.text()}`);
      }
    });

    blackPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[BLACK ERROR] ${msg.text()}`);
      }
    });

    // Log page errors
    whitePage.on('pageerror', err => {
      console.log(`[WHITE PAGE ERROR] ${err.message}`);
    });

    blackPage.on('pageerror', err => {
      console.log(`[BLACK PAGE ERROR] ${err.message}`);
    });
  });

  test.afterAll(async () => {
    await whiteContext?.close();
    await blackContext?.close();
  });

  test('White player can connect and see the connect screen', async () => {
    await whitePage.goto('/');

    // Should see the connect screen with the title
    await expect(whitePage.locator('h1')).toContainText('Fog of War Chess');

    // Should see both play buttons
    await expect(whitePage.locator('button:has-text("Play as White")')).toBeVisible();
    await expect(whitePage.locator('button:has-text("Play as Black")')).toBeVisible();
  });

  test('White player can click Play as White and see lobby', async () => {
    // Click Play as White button
    await whitePage.locator('button:has-text("Play as White")').click();

    // Should transition to lobby screen
    await expect(whitePage.locator('h2')).toContainText('Create Game', { timeout: 30000 });

    // Should see the role badge
    await expect(whitePage.locator('.role-badge')).toContainText('White');

    // Should see password input
    await expect(whitePage.locator('input[type="number"]')).toBeVisible();
  });

  test('White player can create a game', async () => {
    // Fill in the password
    const passwordInput = whitePage.locator('input[type="number"]');
    await passwordInput.fill(gamePassword);

    // Click Create Game button
    await whitePage.locator('button:has-text("Create Game")').click();

    // Wait for game creation (this involves ZK proof generation)
    // Should see a loading/creating state first
    await expect(whitePage.locator('.status-bar')).toContainText(/creating|deploying|generating/i, { timeout: 60000 });

    // Then should see success with game details
    await expect(whitePage.locator('.success')).toBeVisible({ timeout: 120000 });

    // Extract the game ID from the info box
    const gameIdElement = whitePage.locator('.info-value').first();
    await expect(gameIdElement).toBeVisible();
    gameId = await gameIdElement.textContent() || '0';

    console.log(`Game created with ID: ${gameId}`);

    // Should see the Start Playing button
    await expect(whitePage.locator('button:has-text("Start Playing")')).toBeVisible();
  });

  test('Black player can connect and see the connect screen', async () => {
    await blackPage.goto('/');

    // Should see the connect screen
    await expect(blackPage.locator('h1')).toContainText('Fog of War Chess');

    // Should see both play buttons
    await expect(blackPage.locator('button:has-text("Play as Black")')).toBeVisible();
  });

  test('Black player can click Play as Black and see join lobby', async () => {
    // Click Play as Black button
    await blackPage.locator('button:has-text("Play as Black")').click();

    // Should transition to join game screen
    await expect(blackPage.locator('h2')).toContainText('Join Game', { timeout: 30000 });

    // Should see the role badge
    await expect(blackPage.locator('.role-badge')).toContainText('Black');

    // Should see game ID and password inputs
    const inputs = blackPage.locator('input[type="number"]');
    await expect(inputs).toHaveCount(2);
  });

  test('Black player can join the game created by White', async () => {
    // Fill in the game ID and password
    const inputs = blackPage.locator('input[type="number"]');
    await inputs.first().fill(gameId);
    await inputs.last().fill(gamePassword);

    // Click Join Game button
    await blackPage.locator('button:has-text("Join Game")').click();

    // Wait for join process (this involves ZK proof generation)
    await expect(blackPage.locator('.status-bar')).toContainText(/joining|connecting|generating/i, { timeout: 60000 });

    // Should eventually transition to game screen or show success
    // The key test: we should NOT see an IDB error
    await blackPage.waitForTimeout(5000); // Give it time to process

    // Check for errors
    const errorBar = blackPage.locator('.error-bar');
    const hasError = await errorBar.isVisible().catch(() => false);

    if (hasError) {
      const errorText = await errorBar.textContent();
      console.log(`[BLACK] Error encountered: ${errorText}`);
      // Fail the test if we see the IDB error
      expect(errorText).not.toContain('IDBDatabase');
      expect(errorText).not.toContain('database connection is closing');
    }
  });

  test('White player clicks Start Playing and sees chessboard', async () => {
    // Click Start Playing
    await whitePage.locator('button:has-text("Start Playing")').click();

    // Should see the game screen with chessboard
    await expect(whitePage.locator('.board')).toBeVisible({ timeout: 30000 });

    // Should see 64 squares (8x8 grid)
    const squares = whitePage.locator('.square');
    await expect(squares).toHaveCount(64);

    // Should see the turn indicator showing it's White's turn
    await expect(whitePage.locator('.turn-indicator')).toContainText('Your turn');

    // Should see pieces on the board
    const pieces = whitePage.locator('.piece');
    const pieceCount = await pieces.count();
    expect(pieceCount).toBeGreaterThan(0);

    console.log(`[WHITE] Chessboard rendered with ${pieceCount} visible pieces`);
  });

  test('Black player sees chessboard after joining', async () => {
    // Wait for the game screen to load
    // This is the critical test - Black should see the chessboard without IDB errors

    // Give time for the game state to sync
    await blackPage.waitForTimeout(10000);

    // Should see the game screen with chessboard
    const board = blackPage.locator('.board');
    const boardVisible = await board.isVisible().catch(() => false);

    if (!boardVisible) {
      // Take a screenshot for debugging
      await blackPage.screenshot({ path: 'tests/black-no-board.png' });

      // Check what screen we're on
      const pageContent = await blackPage.content();
      console.log('[BLACK] Board not visible. Page state:');

      // Check for specific error messages
      const errorBar = blackPage.locator('.error-bar');
      if (await errorBar.isVisible()) {
        const errorText = await errorBar.textContent();
        console.log(`[BLACK] Error: ${errorText}`);
      }

      // Check for loading state
      const loading = blackPage.locator('.loading');
      if (await loading.isVisible()) {
        console.log('[BLACK] Still in loading state');
      }
    }

    // Assert the board is visible
    await expect(board).toBeVisible({ timeout: 60000 });

    // Should see 64 squares
    const squares = blackPage.locator('.square');
    await expect(squares).toHaveCount(64);

    // Should see the turn indicator (opponent's turn for Black initially)
    await expect(blackPage.locator('.turn-indicator')).toBeVisible();

    // Should see pieces on the board
    const pieces = blackPage.locator('.piece');
    const pieceCount = await pieces.count();
    expect(pieceCount).toBeGreaterThan(0);

    console.log(`[BLACK] Chessboard rendered with ${pieceCount} visible pieces`);

    // Take a success screenshot
    await blackPage.screenshot({ path: 'tests/black-board-success.png' });
  });

  test('Both players see fog of war correctly', async () => {
    // White should see fog squares (black pieces hidden in fog)
    const whiteFogSquares = whitePage.locator('.square.fog');
    const whiteFogCount = await whiteFogSquares.count();
    expect(whiteFogCount).toBeGreaterThan(0);
    console.log(`[WHITE] ${whiteFogCount} squares in fog`);

    // Black should see fog squares (white pieces hidden in fog)
    const blackFogSquares = blackPage.locator('.square.fog');
    const blackFogCount = await blackFogSquares.count();
    expect(blackFogCount).toBeGreaterThan(0);
    console.log(`[BLACK] ${blackFogCount} squares in fog`);
  });

  test('White can select a piece and see valid moves', async () => {
    // Find a white pawn (should be on row 6 from white's perspective)
    // Click on a pawn
    const pawn = whitePage.locator('.square').filter({ has: whitePage.locator('.piece') }).first();
    await pawn.click();

    // Should see the selected state
    await expect(whitePage.locator('.square.selected')).toBeVisible();

    // Should see valid move indicators
    const validMoves = whitePage.locator('.square.valid-move');
    const validMoveCount = await validMoves.count();
    expect(validMoveCount).toBeGreaterThan(0);

    console.log(`[WHITE] Selected piece with ${validMoveCount} valid moves`);

    // Press ESC to deselect
    await whitePage.keyboard.press('Escape');
    await expect(whitePage.locator('.square.selected')).not.toBeVisible();
  });
});

test.describe('Chessboard UI Rendering', () => {
  test('Chessboard has correct structure', async ({ page }) => {
    await page.goto('/');

    // Click Play as White
    await page.locator('button:has-text("Play as White")').click();
    await expect(page.locator('h2')).toContainText('Create Game', { timeout: 30000 });

    // Create a game
    await page.locator('input[type="number"]').fill('999');
    await page.locator('button:has-text("Create Game")').click();

    // Wait for game creation
    await expect(page.locator('.success')).toBeVisible({ timeout: 120000 });

    // Click Start Playing
    await page.locator('button:has-text("Start Playing")').click();

    // Verify board structure
    await expect(page.locator('.board-container')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.board-with-labels')).toBeVisible();
    await expect(page.locator('.board')).toBeVisible();

    // Verify rank labels (1-8)
    const rankLabels = page.locator('.rank-label');
    await expect(rankLabels).toHaveCount(8);

    // Verify file labels (a-h)
    const fileLabels = page.locator('.file-label');
    await expect(fileLabels).toHaveCount(8);

    // Verify 64 squares
    const squares = page.locator('.square');
    await expect(squares).toHaveCount(64);

    // Verify alternating colors
    const lightSquares = page.locator('.square.light');
    const darkSquares = page.locator('.square.dark');
    expect(await lightSquares.count() + await darkSquares.count()).toBe(64);
  });

  test('Chess pieces render as images or Unicode fallback', async ({ page }) => {
    await page.goto('/');
    await page.locator('button:has-text("Play as White")').click();
    await expect(page.locator('h2')).toContainText('Create Game', { timeout: 30000 });

    await page.locator('input[type="number"]').fill('998');
    await page.locator('button:has-text("Create Game")').click();
    await expect(page.locator('.success')).toBeVisible({ timeout: 120000 });
    await page.locator('button:has-text("Start Playing")').click();

    await expect(page.locator('.board')).toBeVisible({ timeout: 30000 });

    // Check for piece elements
    const pieces = page.locator('.piece');
    const pieceCount = await pieces.count();

    // Should have visible pieces (at least white's pieces that are in vision)
    expect(pieceCount).toBeGreaterThan(0);

    // Check if using images or Unicode
    const pieceImages = page.locator('.piece[src]');
    const pieceUnicode = page.locator('.piece-unicode');

    const imageCount = await pieceImages.count();
    const unicodeCount = await pieceUnicode.count();

    console.log(`Piece rendering: ${imageCount} images, ${unicodeCount} unicode`);

    // Should be using one or the other
    expect(imageCount + unicodeCount).toBeGreaterThan(0);
  });
});
