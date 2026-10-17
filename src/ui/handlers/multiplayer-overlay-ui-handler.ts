import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";
import { addWindow, WindowVariant } from "#ui/ui-theme";
import { multiplayerManager } from "../../multiplayer/multiplayer-manager";

/**
 * 竞速/同调模式屏幕悬浮 HUD 挂件
 * 显示队友/对手的实时波次、存活宝可梦数量及状态
 */
export class MultiplayerOverlayWidget {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.NineSlice;
  private headerText: Phaser.GameObjects.Text;
  private waveText: Phaser.GameObjects.Text;
  private partyStatusText: Phaser.GameObjects.Text;

  private isVisible = false;

  public setup(): void {
    const width = 110;
    const height = 36;
    const x = globalScene.scaledCanvas.width - width - 2;
    const y = 2;

    this.container = globalScene.add.container(x, y);
    this.container.setName("multiplayer-overlay-widget");
    this.container.setDepth(100);
    this.container.setVisible(false);

    this.bg = addWindow(0, 0, width, height, false, false, 0, 0, WindowVariant.THIN);
    this.container.add(this.bg);

    this.headerText = addTextObject(4, 3, "队友状态", TextStyle.BATTLE_INFO, {
      fontSize: "30px",
    });
    this.container.add(this.headerText);

    this.waveText = addTextObject(4, 14, "层数: 1", TextStyle.MONEY, {
      fontSize: "28px",
    });
    this.container.add(this.waveText);

    this.partyStatusText = addTextObject(4, 24, "存活: 6/6", TextStyle.PARTY, {
      fontSize: "26px",
    });
    this.container.add(this.partyStatusText);

    // 订阅更新
    multiplayerManager.onRoomUpdate(() => {
      this.updateDisplay();
    });
  }

  public show(): void {
    this.isVisible = true;
    this.container.setVisible(true);
    this.updateDisplay();
  }

  public hide(): void {
    this.isVisible = false;
    this.container.setVisible(false);
  }

  public updateDisplay(): void {
    if (!this.isVisible || !multiplayerManager.isInRoom) {
      this.container.setVisible(false);
      return;
    }

    const teammate = multiplayerManager.getTeammate();
    if (!teammate) {
      this.headerText.setText("等待连接...");
      this.waveText.setText("");
      this.partyStatusText.setText("");
      return;
    }

    this.container.setVisible(true);
    this.headerText.setText(`[对战] ${teammate.name}`);
    this.waveText.setText(`层数: ${teammate.currentWave ?? 1}`);

    const living = teammate.livingPokemonCount ?? (teammate.partyPreview?.filter(p => !p.isFainted).length ?? 6);
    const total = teammate.partyPreview?.length ?? 6;
    this.partyStatusText.setText(`存活: ${living}/${total}`);

    if (teammate.hasFinished) {
      this.waveText.setText("已完成比赛！");
    }
  }
}

export const multiplayerOverlayWidget = new MultiplayerOverlayWidget();
