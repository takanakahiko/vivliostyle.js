/**
 * Copyright 2016 Trim-marks Inc.
 * Copyright 2019 Vivliostyle Foundation
 *
 * Vivliostyle.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Vivliostyle.js is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Vivliostyle.js.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @fileoverview Selectors - Utilities for selectors.
 */
import * as Asserts from "./asserts";
import * as Base from "./base";
import * as LayoutHelper from "./layouthelper";
import * as Matchers from "./matchers";
import * as PseudoElement from "./pseudoelement";
import * as Task from "./task";
import * as VtreeImpl from "./vtree";
import {
  FragmentLayoutConstraintType,
  Layout,
  Selectors,
  Vtree
} from "./types";

export const isInstanceOfAfterIfContinuesLayoutConstraint =
  Selectors.isInstanceOfAfterIfContinuesLayoutConstraint;
export const registerFragmentIndex =
  Matchers.NthFragmentMatcher.registerFragmentIndex;
export const clearFragmentIndices =
  Matchers.NthFragmentMatcher.clearFragmentIndices;

// FIXME: When importing layoututil module statically, it causes a circular dependency.
let LayoutUtil: typeof import("./layoututil");
import("./layoututil").then(it => {
  LayoutUtil = it;
});

export class AfterIfContinues implements Selectors.AfterIfContinues {
  constructor(
    public readonly sourceNode: Element,
    public readonly styler: PseudoElement.PseudoelementStyler
  ) {}

  createElement(
    column: Layout.Column,
    parentNodeContext: Vtree.NodeContext
  ): Task.Result<Element> {
    if (!LayoutUtil) {
      throw new Error("layoututil module is required but not be imported.");
    }
    const doc = parentNodeContext.viewNode.ownerDocument;
    const viewRoot = doc.createElement("div");
    const pseudoColumn = new LayoutUtil.PseudoColumn(
      column,
      viewRoot,
      parentNodeContext
    );
    const initialPageBreakType = pseudoColumn.getColumn().pageBreakType;
    pseudoColumn.getColumn().pageBreakType = null;
    return pseudoColumn
      .layout(this.createNodePositionForPseudoElement(), true)
      .thenAsync(() => {
        this.styler.contentProcessed["after-if-continues"] = false;
        pseudoColumn.getColumn().pageBreakType = initialPageBreakType;
        const pseudoElement = viewRoot.firstChild as Element;
        Base.setCSSProperty(pseudoElement, "display", "block");
        return Task.newResult(pseudoElement);
      });
  }

  private createNodePositionForPseudoElement(): Vtree.ChunkPosition {
    const sourceNode = PseudoElement.document.createElementNS(
      Base.NS.XHTML,
      "div"
    );
    PseudoElement.setPseudoName(sourceNode, "after-if-continues");
    const shadowContext = this.createShadowContext(sourceNode);
    const step = {
      node: sourceNode,
      shadowType: shadowContext.type,
      shadowContext,
      nodeShadow: null,
      shadowSibling: null
    };
    const nodePosition = {
      steps: [step],
      offsetInNode: 0,
      after: false,
      preprocessedTextContent: null
    };
    return new VtreeImpl.ChunkPosition(nodePosition as any);
  }

  private createShadowContext(root: Element): Vtree.ShadowContext {
    return new VtreeImpl.ShadowContext(
      this.sourceNode,
      root,
      null,
      null,
      null,
      Vtree.ShadowType.ROOTED,
      this.styler
    );
  }
}

export class AfterIfContinuesLayoutConstraint
  implements Selectors.AfterIfContinuesLayoutConstraint {
  flagmentLayoutConstraintType: FragmentLayoutConstraintType =
    "AfterIfContinue";

  constructor(
    public nodeContext: Vtree.NodeContext,
    public afterIfContinues: Selectors.AfterIfContinues,
    public pseudoElementHeight: number
  ) {}

  /** @override */
  allowLayout(
    nodeContext: Vtree.NodeContext,
    overflownNodeContext: Vtree.NodeContext,
    column: Layout.Column
  ): boolean {
    if (
      (overflownNodeContext && !nodeContext) ||
      (nodeContext && nodeContext.overflow)
    ) {
      return false;
    } else {
      return true;
    }
  }

  /** @override */
  nextCandidate(nodeContext: Vtree.NodeContext): boolean {
    return false;
  }

  /** @override */
  postLayout(
    allowed: boolean,
    positionAfter: Vtree.NodeContext,
    initialPosition: Vtree.NodeContext,
    column: Layout.Column
  ) {}

  /** @override */
  finishBreak(
    nodeContext: Vtree.NodeContext,
    column: Layout.Column
  ): Task.Result<boolean> {
    if (!this.getRepetitiveElements().affectTo(nodeContext)) {
      return Task.newResult(true);
    }
    return this.afterIfContinues
      .createElement(column, this.nodeContext)
      .thenAsync(element => {
        this.nodeContext.viewNode.appendChild(element);
        return Task.newResult(true);
      });
  }

  getRepetitiveElements() {
    return new AfterIfContinuesElementsOffset(
      this.nodeContext,
      this.pseudoElementHeight
    );
  }

  /** @override */
  equalsTo(constraint: Layout.FragmentLayoutConstraint): boolean {
    if (!(constraint instanceof AfterIfContinuesLayoutConstraint)) {
      return false;
    }
    return (
      this.afterIfContinues ==
      (constraint as AfterIfContinuesLayoutConstraint).afterIfContinues
    );
  }

  /** @override */
  getPriorityOfFinishBreak(): number {
    return 9;
  }
}

export class AfterIfContinuesElementsOffset
  implements Selectors.AfterIfContinuesElementsOffset {
  constructor(public nodeContext, public pseudoElementHeight) {}

  /** @override */
  calculateOffset(nodeContext: Vtree.NodeContext): number {
    if (!this.affectTo(nodeContext)) {
      return 0;
    }
    return this.pseudoElementHeight;
  }

  /** @override */
  calculateMinimumOffset(nodeContext: Vtree.NodeContext): number {
    return this.calculateOffset(nodeContext);
  }

  affectTo(nodeContext: Vtree.NodeContext): boolean {
    if (!nodeContext) {
      return false;
    }
    const sourceNode = nodeContext.shadowContext
      ? nodeContext.shadowContext.owner
      : nodeContext.sourceNode;
    if (sourceNode === this.nodeContext.sourceNode) {
      return !!nodeContext.after;
    }
    for (let n = sourceNode.parentNode; n; n = n.parentNode) {
      if (n === this.nodeContext.sourceNode) {
        return true;
      }
    }
    return false;
  }
}

function processAfterIfContinuesOfNodeContext(
  nodeContext: Vtree.NodeContext,
  column: Layout.Column
): Task.Result<Vtree.NodeContext> {
  if (
    !nodeContext ||
    !nodeContext.afterIfContinues ||
    nodeContext.after ||
    column.isFloatNodeContext(nodeContext)
  ) {
    return Task.newResult(nodeContext);
  }
  const afterIfContinues = nodeContext.afterIfContinues;
  return afterIfContinues
    .createElement(column, nodeContext)
    .thenAsync(pseudoElement => {
      Asserts.assert(nodeContext !== null);
      const pseudoElementHeight = calculatePseudoElementHeight(
        nodeContext,
        column,
        pseudoElement
      );
      column.fragmentLayoutConstraints.push(
        new AfterIfContinuesLayoutConstraint(
          nodeContext as Vtree.NodeContext,
          afterIfContinues,
          pseudoElementHeight
        )
      );
      return Task.newResult(nodeContext);
    });
}

export function processAfterIfContinues(
  result: Task.Result<Vtree.NodeContext>,
  column: Layout.Column
): Task.Result<Vtree.NodeContext> {
  return result.thenAsync(nodeContext =>
    processAfterIfContinuesOfNodeContext(nodeContext, column)
  );
}

export function processAfterIfContinuesOfAncestors(
  nodeContext: Vtree.NodeContext,
  column: Layout.Column
): Task.Result<boolean> {
  const frame: Task.Frame<boolean> = Task.newFrame(
    "processAfterIfContinuesOfAncestors"
  );
  let current: Vtree.NodeContext = nodeContext;
  frame
    .loop(() => {
      if (current !== null) {
        const result = processAfterIfContinuesOfNodeContext(current, column);
        current = current.parent;
        return result.thenReturn(true);
      } else {
        return Task.newResult(false);
      }
    })
    .then(() => {
      frame.finish(true);
    });
  return frame.result();
}

export function calculatePseudoElementHeight(
  nodeContext: Vtree.NodeContext,
  column: Layout.Column,
  pseudoElement: Element
): number {
  const parentNode = nodeContext.viewNode as Element;
  parentNode.appendChild(pseudoElement);
  const height = LayoutHelper.getElementHeight(
    pseudoElement,
    column,
    nodeContext.vertical
  );
  parentNode.removeChild(pseudoElement);
  return height;
}
