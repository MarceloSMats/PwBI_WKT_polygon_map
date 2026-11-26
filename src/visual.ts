"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import ITooltipService = powerbi.extensibility.ITooltipService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

import { VisualFormattingSettingsModel } from "./settings";
import * as L from "leaflet";
import * as wellknown from "wellknown";

const LAYER_PALETTE: string[] = [
    "#3b82f6", // Blue
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#8b5cf6", // Purple
    "#ec4899", // Pink
    "#06b6d4", // Cyan
    "#ef4444", // Red
    "#14b8a6", // Teal
    "#f97316", // Orange
    "#6366f1", // Indigo
    "#84cc16", // Lime
    "#d946ef"  // Fuchsia
];

interface LayerConfig {
    id: string;
    name: string;
    color: string;
    visible: boolean;
    count: number;
    leafletLayer: L.Layer;
    leafletGroup?: L.FeatureGroup;
    type: "wkt" | "wms" | "wmts" | "wfs";
    layerIndex: number;
}

interface PolygonItem {
    uniqueKey: string;
    selectionKey: string;
    index: number;
    layerId: string;
    layerName: string;
    layerIndex: number;
    category: string;
    wkt: string;
    customFillColor: string;
    fillColor: string;
    selectionId: ISelectionId;
    isHighlighted: boolean;
    tooltips: VisualTooltipDataItem[];
    geoJson: GeoJSON.Feature<GeoJSON.Geometry, any>;
    geoJsonLayer?: L.GeoJSON;
    layer?: L.Path;
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    centerLat: number;
    centerLng: number;
    labelLat: number;
    labelLng: number;
    diagonalDegrees: number;
    polygonSize?: number;
    lastScreenPx: number;
}

interface GeometryMetrics {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    centerLat: number;
    centerLng: number;
    labelLat: number;
    labelLng: number;
    diagonalDegrees: number;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private mapContainer: HTMLDivElement;
    private emptyStateElement: HTMLDivElement;
    private legendElement: HTMLDivElement;
    private layerControlContainer: HTMLDivElement;
    private toolbarContainer: HTMLDivElement;
    private boxSelectBtn: HTMLButtonElement;
    private fitBoundsBtn: HTMLButtonElement;
    private selectionBoxElement: HTMLDivElement;

    private map: L.Map | null = null;
    private currentTileLayer: L.TileLayer | null = null;
    private currentBasemapKey = "";

    // Dedicated renderers & caches for high performance
    private canvasRenderer: L.Canvas | null = null;
    private svgRenderer: L.SVG | null = null;
    private lastRendererType = "canvas";
    private lastSmoothFactor = 1.0;

    private labelLayerGroup: L.LayerGroup = L.layerGroup();
    private wktCache: Map<string, GeoJSON.Geometry | null> = new Map();
    private metricsCache: Map<string, GeometryMetrics | null> = new Map();
    private strokeColorCache: Map<string, string> = new Map();
    private mountedItems: Set<PolygonItem> = new Set();

    private lastTooltipTime = 0;
    private isFetchingMore = false;
    private totalAccumulatedRows = 0;
    private currentRenderedCount = 0;

    // Signatures to separate Data/Filter updates from Formatting/Style updates
    private lastStructuralSignature = "";
    private lastFilterSignature = "";
    private hasExternalHighlights = false;

    // Spatial Box Selection State
    private isBoxSelectMode = false;
    private isDraggingBox = false;
    private boxStartPoint: L.Point | null = null;
    private suppressNextMapClick = false;

    // External Layer (WMS / WMTS / WFS) properties
    private currentWmsLayer: L.TileLayer.WMS | null = null;
    private currentWmsKey = "";
    private currentWmtsLayer: L.TileLayer | null = null;
    private currentWmtsKey = "";
    private cachedWfsUrl = "";
    private cachedWfsGeoJson: any = null;
    private isFetchingWfs = false;
    private wfsLayerGroup: L.FeatureGroup | null = null;

    private layers: Map<string, LayerConfig> = new Map();
    private layerVisibilityState: Map<string, boolean> = new Map();
    private isLayerPanelExpanded = true;
    private hasAutoCollapsedCompact = false;

    private items: PolygonItem[] = [];
    private selectedIds: Set<string> = new Set();
    private selectedUniqueKeys: Set<string> = new Set();
    private hasInitialFitDone = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.target = options.element;
        this.selectionManager = this.host.createSelectionManager();
        this.tooltipService = this.host.tooltipService;
        this.formattingSettingsService = new FormattingSettingsService();

        this.mapContainer = document.createElement("div");
        this.mapContainer.className = "wkt-map-container";
        this.target.appendChild(this.mapContainer);

        const mapCanvas = document.createElement("div");
        mapCanvas.className = "wkt-map-canvas";
        this.mapContainer.appendChild(mapCanvas);

        // Spatial Selection Box Overlay
        this.selectionBoxElement = document.createElement("div");
        this.selectionBoxElement.className = "wkt-selection-box";
        this.mapContainer.appendChild(this.selectionBoxElement);

        // Interactive Map Toolbar (Box Select & Fit Bounds)
        this.toolbarContainer = document.createElement("div");
        this.toolbarContainer.className = "wkt-map-toolbar";

        this.boxSelectBtn = document.createElement("button");
        this.boxSelectBtn.className = "wkt-tool-btn";
        this.boxSelectBtn.type = "button";
        this.boxSelectBtn.title = "Seleção por Área (Retângulo) — ou segure Shift e arraste no mapa";
        this.boxSelectBtn.textContent = "⬚";
        this.boxSelectBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleBoxSelectMode(!this.isBoxSelectMode);
        });
        this.toolbarContainer.appendChild(this.boxSelectBtn);

        this.fitBoundsBtn = document.createElement("button");
        this.fitBoundsBtn.className = "wkt-tool-btn";
        this.fitBoundsBtn.type = "button";
        this.fitBoundsBtn.title = "Enquadrar Polígonos Visíveis (Ajustar Zoom)";
        this.fitBoundsBtn.textContent = "⛶";
        this.fitBoundsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.fitBoundsToVisibleLayers(true);
        });
        this.toolbarContainer.appendChild(this.fitBoundsBtn);

        this.mapContainer.appendChild(this.toolbarContainer);
        L.DomEvent.disableClickPropagation(this.toolbarContainer);
        L.DomEvent.disableScrollPropagation(this.toolbarContainer);

        // Empty state overlay
        this.emptyStateElement = document.createElement("div");
        this.emptyStateElement.className = "wkt-map-empty-state";
        const iconDiv = document.createElement("div");
        iconDiv.className = "empty-icon";
        iconDiv.textContent = "🗺️";
        this.emptyStateElement.appendChild(iconDiv);

        const titleH3 = document.createElement("h3");
        titleH3.textContent = "WKT Polygon Map";
        this.emptyStateElement.appendChild(titleH3);

        const descP = document.createElement("p");
        descP.textContent = "Arraste uma ou mais colunas com polígonos WKT para renderizar as camadas no mapa.";
        this.emptyStateElement.appendChild(descP);
        this.mapContainer.appendChild(this.emptyStateElement);

        // Layer Control Container
        this.layerControlContainer = document.createElement("div");
        this.layerControlContainer.className = "wkt-layer-control";
        this.layerControlContainer.style.display = "none";
        this.mapContainer.appendChild(this.layerControlContainer);

        // Prevent Leaflet map click and scroll events inside overlays
        L.DomEvent.disableClickPropagation(this.layerControlContainer);
        L.DomEvent.disableScrollPropagation(this.layerControlContainer);

        // Bottom status badge
        this.legendElement = document.createElement("div");
        this.legendElement.className = "wkt-map-legend";
        this.legendElement.style.display = "none";
        this.mapContainer.appendChild(this.legendElement);
        L.DomEvent.disableClickPropagation(this.legendElement);

        this.initLeafletMap(mapCanvas);
        this.initSpatialBoxSelection();
    }

    private initLeafletMap(container: HTMLElement) {
        this.map = L.map(container, {
            center: [-15.7801, -47.9292], // Default Brazil
            zoom: 4,
            zoomControl: true,
            attributionControl: true,
            preferCanvas: true,
            boxZoom: false // Replaced by Spatial Box Selection for Power BI cross-filtering
        });

        this.canvasRenderer = L.canvas({ padding: 0.5, tolerance: 6 });
        this.svgRenderer = L.svg({ padding: 0.5 });
        this.labelLayerGroup.addTo(this.map);

        this.map.on("moveend zoomend", () => {
            this.updateVisiblePolygons();
            this.updateLabelsVisibility();
        });

        this.updateTileLayer("carto-light");

        // Clear selection when clicking map background
        this.map.on("click", (e: L.LeafletMouseEvent) => {
            if (this.suppressNextMapClick) {
                this.suppressNextMapClick = false;
                return;
            }
            const originalTarget = e.originalEvent.target as HTMLElement;
            if (originalTarget && originalTarget.classList.contains("leaflet-interactive")) {
                return;
            }
            if (this.selectedIds.size > 0 || this.selectedUniqueKeys.size > 0) {
                this.clearSelection();
            }
        });

        // Right-click context menu on empty map area
        this.map.on("contextmenu", (e: L.LeafletMouseEvent) => {
            const originalTarget = e.originalEvent.target as HTMLElement;
            if (originalTarget && originalTarget.classList.contains("leaflet-interactive")) {
                return;
            }
            e.originalEvent.preventDefault();
            this.selectionManager.showContextMenu({}, {
                x: e.originalEvent.clientX,
                y: e.originalEvent.clientY
            });
        });
    }

    private toggleBoxSelectMode(enabled: boolean) {
        this.isBoxSelectMode = enabled;
        if (enabled) {
            this.boxSelectBtn.classList.add("is-active");
            this.mapContainer.classList.add("is-box-selecting");
            this.map?.dragging.disable();
        } else {
            this.boxSelectBtn.classList.remove("is-active");
            this.mapContainer.classList.remove("is-box-selecting");
            this.map?.dragging.enable();
            this.selectionBoxElement.style.display = "none";
            this.isDraggingBox = false;
            this.boxStartPoint = null;
        }
    }

    private initSpatialBoxSelection() {
        const getContainerPoint = (ev: MouseEvent): L.Point => {
            const rect = this.mapContainer.getBoundingClientRect();
            return L.point(ev.clientX - rect.left, ev.clientY - rect.top);
        };

        this.mapContainer.addEventListener("mousedown", (e: MouseEvent) => {
            if (e.button !== 0) return;
            const enableBoxSelect = this.formattingSettings?.mapConfig?.enableBoxSelect?.value ?? true;
            if (!enableBoxSelect && !this.isBoxSelectMode) return;

            const targetEl = e.target as HTMLElement;
            if (
                targetEl.closest(".wkt-layer-control") ||
                targetEl.closest(".wkt-map-toolbar") ||
                targetEl.closest(".wkt-map-legend") ||
                targetEl.closest(".leaflet-control")
            ) {
                return;
            }

            if (this.isBoxSelectMode || e.shiftKey) {
                this.isDraggingBox = true;
                this.boxStartPoint = getContainerPoint(e);
                this.map?.dragging.disable();

                this.selectionBoxElement.style.left = `${this.boxStartPoint.x}px`;
                this.selectionBoxElement.style.top = `${this.boxStartPoint.y}px`;
                this.selectionBoxElement.style.width = "0px";
                this.selectionBoxElement.style.height = "0px";
                this.selectionBoxElement.style.display = "block";
                e.preventDefault();
            }
        });

        window.addEventListener("mousemove", (e: MouseEvent) => {
            if (!this.isDraggingBox || !this.boxStartPoint) return;

            const currentPoint = getContainerPoint(e);
            const left = Math.min(this.boxStartPoint.x, currentPoint.x);
            const top = Math.min(this.boxStartPoint.y, currentPoint.y);
            const width = Math.abs(currentPoint.x - this.boxStartPoint.x);
            const height = Math.abs(currentPoint.y - this.boxStartPoint.y);

            this.selectionBoxElement.style.left = `${left}px`;
            this.selectionBoxElement.style.top = `${top}px`;
            this.selectionBoxElement.style.width = `${width}px`;
            this.selectionBoxElement.style.height = `${height}px`;
        });

        window.addEventListener("mouseup", (e: MouseEvent) => {
            if (!this.isDraggingBox || !this.boxStartPoint) return;

            const endPoint = getContainerPoint(e);
            const startPoint = this.boxStartPoint;

            this.isDraggingBox = false;
            this.boxStartPoint = null;
            this.selectionBoxElement.style.display = "none";

            const width = Math.abs(endPoint.x - startPoint.x);
            const height = Math.abs(endPoint.y - startPoint.y);

            if (!this.isBoxSelectMode) {
                this.map?.dragging.enable();
            } else {
                this.toggleBoxSelectMode(false);
            }

            if (width < 6 && height < 6) {
                return;
            }

            this.suppressNextMapClick = true;
            if (!this.map) return;

            const nw = this.map.containerPointToLatLng(L.point(Math.min(startPoint.x, endPoint.x), Math.min(startPoint.y, endPoint.y)));
            const se = this.map.containerPointToLatLng(L.point(Math.max(startPoint.x, endPoint.x), Math.max(startPoint.y, endPoint.y)));
            const boxBounds = L.latLngBounds(nw, se);

            const north = boxBounds.getNorth();
            const south = boxBounds.getSouth();
            const east = boxBounds.getEast();
            const west = boxBounds.getWest();

            const matchedSelectionIds: ISelectionId[] = [];
            const seenKeys = new Set<string>();
            const matchedUniqueKeys: string[] = [];

            for (const item of this.items) {
                const layerConfig = this.layers.get(item.layerId);
                if (!layerConfig || !layerConfig.visible) continue;

                const intersects = !(
                    item.maxLat < south ||
                    item.minLat > north ||
                    item.maxLng < west ||
                    item.minLng > east
                );

                if (intersects) {
                    matchedUniqueKeys.push(item.uniqueKey);
                    if (!seenKeys.has(item.selectionKey)) {
                        seenKeys.add(item.selectionKey);
                        matchedSelectionIds.push(item.selectionId);
                    }
                }
            }

            if (matchedSelectionIds.length > 0) {
                const additive = e.ctrlKey || e.metaKey;
                this.selectionManager.select(matchedSelectionIds, additive).then((ids: ISelectionId[]) => {
                    this.selectedIds.clear();
                    ids.forEach(id => this.selectedIds.add(id.getKey()));
                    if (!additive) {
                        this.selectedUniqueKeys.clear();
                    }
                    matchedUniqueKeys.forEach(k => this.selectedUniqueKeys.add(k));
                    this.applySelectionStyles();
                    this.updateLegendCount();
                });
            }
        });
    }

    private clearSelection() {
        this.selectionManager.clear().then(() => {
            this.selectedIds.clear();
            this.selectedUniqueKeys.clear();
            this.applySelectionStyles();
            this.updateLegendCount();
        });
    }

    private updateTileLayer(basemapKey: string, customUrl?: string) {
        if (!this.map) return;

        const key = basemapKey === "custom" ? `custom:${customUrl}` : basemapKey;
        if (key === this.currentBasemapKey && this.currentTileLayer) {
            return;
        }

        if (this.currentTileLayer) {
            this.map.removeLayer(this.currentTileLayer);
            this.currentTileLayer = null;
        }

        let tileUrl = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
        let attribution = "&copy; <a href='https://www.openstreetmap.org/copyright'>OSM</a> &copy; <a href='https://carto.com/'>CARTO</a>";
        let subdomains: string | string[] = "abcd";
        let maxZoom = 19;

        switch (basemapKey) {
            case "carto-dark":
                tileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
                break;
            case "osm":
                tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
                attribution = "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>";
                subdomains = "abc";
                break;
            case "esri-satellite":
                tileUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
                attribution = "Tiles &copy; Esri";
                subdomains = "";
                maxZoom = 18;
                break;
            case "custom":
                if (customUrl && customUrl.trim().length > 0) {
                    tileUrl = customUrl.trim();
                    attribution = "";
                }
                break;
            case "carto-light":
            default:
                tileUrl = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
                break;
        }

        this.currentTileLayer = L.tileLayer(tileUrl, {
            attribution: attribution,
            subdomains: subdomains,
            maxZoom: maxZoom
        }).addTo(this.map);

        this.currentBasemapKey = key;
    }

    private updateResponsiveLayout(viewport?: powerbi.IViewport) {
        const width = viewport?.width || this.mapContainer.clientWidth || 500;
        const height = viewport?.height || this.mapContainer.clientHeight || 400;
        const isCompact = width < 380 || height < 260;

        if (isCompact) {
            this.mapContainer.classList.add("is-compact");
            if (!this.hasAutoCollapsedCompact) {
                this.isLayerPanelExpanded = false;
                this.hasAutoCollapsedCompact = true;
            }
        } else {
            this.mapContainer.classList.remove("is-compact");
        }
    }

    private computeDataSignatures(dataView?: powerbi.DataView): { structuralSig: string; filterSig: string } {
        if (!dataView) return { structuralSig: "empty", filterSig: "empty" };

        const invertCoords = this.formattingSettings?.mapConfig?.invertCoordinates?.value ?? false;
        const showWkt = this.formattingSettings?.tooltipConfig?.showWktInTooltip?.value ?? false;

        if (dataView.categorical) {
            const cats = dataView.categorical.categories || [];
            const vals = dataView.categorical.values || [];
            const rowCount = cats[0]?.values?.length || 0;

            const catNames = cats.map(c => c.source.queryName).join("|");
            const valNames = vals.map(v => v.source.queryName).join("|");
            const firstWkt = rowCount > 0 ? String(cats[0].values[0] ?? "").slice(0, 40) : "";
            const midWkt = rowCount > 2 ? String(cats[0].values[Math.floor(rowCount / 2)] ?? "").slice(0, 40) : "";
            const lastWkt = rowCount > 1 ? String(cats[0].values[rowCount - 1] ?? "").slice(0, 40) : "";

            let highlightCount = 0;
            let firstHighlightIdx = -1;
            let lastHighlightIdx = -1;
            let fillSample = "";

            for (const v of vals) {
                if (v.source.roles && v.source.roles["fillColor"] && v.values.length > 0) {
                    fillSample = `${String(v.values[0] ?? "")}:${String(v.values[v.values.length - 1] ?? "")}`;
                }
                if (v.highlights && v.highlights.length > 0) {
                    for (let i = 0; i < v.highlights.length; i++) {
                        if (v.highlights[i] !== null && v.highlights[i] !== undefined) {
                            highlightCount++;
                            if (firstHighlightIdx === -1) firstHighlightIdx = i;
                            lastHighlightIdx = i;
                        }
                    }
                }
            }

            const filterSig = `cat:${rowCount}:${firstWkt}:${midWkt}:${lastWkt}:hl:${highlightCount}:${firstHighlightIdx}:${lastHighlightIdx}`;
            const structuralSig = `${catNames}::${valNames}::inv:${invertCoords}::wktTip:${showWkt}::fill:${fillSample}::${filterSig}`;
            return { structuralSig, filterSig };
        }

        if (dataView.table) {
            const rows = dataView.table.rows || [];
            const rowCount = rows.length;
            const colNames = (dataView.table.columns || []).map(c => c.queryName).join("|");
            const firstRow = rowCount > 0 ? String(rows[0][0] ?? "").slice(0, 40) : "";
            const lastRow = rowCount > 1 ? String(rows[rowCount - 1][0] ?? "").slice(0, 40) : "";
            const filterSig = `tbl:${rowCount}:${firstRow}:${lastRow}`;
            const structuralSig = `${colNames}::inv:${invertCoords}::wktTip:${showWkt}::${filterSig}`;
            return { structuralSig, filterSig };
        }

        return { structuralSig: "none", filterSig: "none" };
    }

    public update(options: VisualUpdateOptions) {
        this.updateResponsiveLayout(options.viewport);

        // Fast path 1: Purely a resize or viewport event
        const isOnlyResize = (options.type === powerbi.VisualUpdateType.Resize || options.type === powerbi.VisualUpdateType.ResizeEnd)
            && !(options.type & powerbi.VisualUpdateType.Data);

        if (isOnlyResize) {
            if (this.map) {
                this.map.invalidateSize();
            }
            this.renderLayerControl();
            return;
        }

        const dataView = options.dataViews?.[0];
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            dataView
        );

        if (this.map) {
            setTimeout(() => {
                this.map?.invalidateSize();
            }, 50);
        }

        const selectedBasemap = (this.formattingSettings?.mapConfig?.basemap?.value as string) || "carto-light";
        const customUrl = this.formattingSettings?.mapConfig?.customStyleUrl?.value || "";
        this.updateTileLayer(selectedBasemap, customUrl);

        // Update box select button visibility
        const enableBoxSelect = this.formattingSettings?.mapConfig?.enableBoxSelect?.value ?? true;
        this.boxSelectBtn.style.display = enableBoxSelect ? "flex" : "none";
        if (!enableBoxSelect && this.isBoxSelectMode) {
            this.toggleBoxSelectMode(false);
        }

        const { structuralSig, filterSig } = this.computeDataSignatures(dataView);
        const isAppend = options.operationKind === powerbi.VisualDataChangeOperationKind.Append;
        const isStyleOnlyUpdate = !isAppend
            && this.hasInitialFitDone
            && structuralSig === this.lastStructuralSignature
            && filterSig === this.lastFilterSignature;

        // Fast path 2: Purely formatting/style change in the Power BI Formatting Pane
        // Updates polygon colors, borders, opacities, and labels in <5ms WITHOUT resetting user zoom!
        if (isStyleOnlyUpdate) {
            this.refreshStylesInPlace();
            this.updateExternalLayer();
            this.syncVisibleLayersOnMap();
            this.updateVisiblePolygons();
            this.renderLabels();
            this.renderLayerControl();
            return;
        }

        const didFilterChange = this.hasInitialFitDone && filterSig !== this.lastFilterSignature;
        this.lastStructuralSignature = structuralSig;
        this.lastFilterSignature = filterSig;

        this.parseData(options, isAppend);
        this.syncSelectionManagerIds();
        this.updateExternalLayer();
        this.renderPolygons(didFilterChange);
        this.renderLayerControl();

        // Progressive streaming (fetchMoreData)
        const autoFetch = this.formattingSettings?.lodConfig?.autoFetchMore?.value ?? true;
        const maxRowsLimit = (this.formattingSettings?.lodConfig?.maxTotalRows?.value ?? 100000) as number;

        const currentRowsCount = dataView?.categorical?.categories?.[0]?.values?.length
            || dataView?.table?.rows?.length
            || 0;
        this.totalAccumulatedRows = currentRowsCount;

        if (autoFetch && dataView?.metadata?.segment && currentRowsCount < maxRowsLimit && !this.isFetchingMore) {
            this.isFetchingMore = true;
            setTimeout(() => {
                try {
                    const more = this.host.fetchMoreData(true);
                    if (!more) {
                        this.isFetchingMore = false;
                    }
                } catch {
                    this.isFetchingMore = false;
                }
            }, 60);
        } else if (!dataView?.metadata?.segment || currentRowsCount >= maxRowsLimit) {
            this.isFetchingMore = false;
        }
    }

    private syncSelectionManagerIds() {
        const hostIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        if (hostIds && hostIds.length > 0 && this.selectedIds.size === 0) {
            hostIds.forEach(id => this.selectedIds.add(id.getKey()));
        }
        // If external highlights arrived from another visual, clear local click selection to yield to cross-highlighting
        if (this.hasExternalHighlights && this.selectedIds.size > 0) {
            this.selectedIds.clear();
            this.selectedUniqueKeys.clear();
        }
    }

    private refreshStylesInPlace() {
        const defaultColor = this.formattingSettings?.polygonConfig?.defaultFillColor?.value?.value || "#3b82f6";
        const renderEngine = (this.formattingSettings?.mapConfig?.renderEngine?.value as string) || "canvas";
        const smoothFactorVal = (this.formattingSettings?.mapConfig?.smoothFactor?.value ?? 1.0) as number;

        const rendererChanged = renderEngine !== this.lastRendererType || smoothFactorVal !== this.lastSmoothFactor;
        this.lastRendererType = renderEngine;
        this.lastSmoothFactor = smoothFactorVal;

        const wktLayersCount = Array.from(this.layers.values()).filter(l => l.type === "wkt").length;
        const multiLayers = wktLayersCount > 1;

        this.layers.forEach(layer => {
            if (layer.type === "wkt") {
                layer.color = multiLayers
                    ? LAYER_PALETTE[layer.layerIndex % LAYER_PALETTE.length]
                    : defaultColor;
            }
        });

        for (const item of this.items) {
            const layerDefaultColor = multiLayers
                ? LAYER_PALETTE[item.layerIndex % LAYER_PALETTE.length]
                : defaultColor;
            item.fillColor = item.customFillColor || layerDefaultColor;

            if (rendererChanged && item.geoJsonLayer) {
                const layerConfig = this.layers.get(item.layerId);
                if (layerConfig?.leafletGroup && layerConfig.leafletGroup.hasLayer(item.geoJsonLayer)) {
                    layerConfig.leafletGroup.removeLayer(item.geoJsonLayer);
                }
                item.geoJsonLayer = undefined;
                item.layer = undefined;
            }
        }

        if (rendererChanged) {
            this.mountedItems.clear();
        }
    }

    private syncVisibleLayersOnMap() {
        if (!this.map) return;
        this.layers.forEach(layer => {
            if (layer.visible) {
                if (!this.map!.hasLayer(layer.leafletLayer)) {
                    layer.leafletLayer.addTo(this.map!);
                }
            } else {
                if (this.map!.hasLayer(layer.leafletLayer)) {
                    this.map!.removeLayer(layer.leafletLayer);
                }
            }
        });
    }

    private parseData(options: VisualUpdateOptions, isAppend = false) {
        const prevItemsByKey = new Map<string, PolygonItem>();
        if (isAppend && this.items.length > 0) {
            for (const item of this.items) {
                prevItemsByKey.set(item.uniqueKey, item);
            }
        }

        this.layers.forEach(l => {
            if (this.map?.hasLayer(l.leafletLayer)) {
                this.map.removeLayer(l.leafletLayer);
            }
            if (l.type === "wkt" && l.leafletGroup) {
                l.leafletGroup.clearLayers();
            }
        });

        this.items = [];
        this.layers.clear();
        this.mountedItems.clear();
        this.hasExternalHighlights = false;

        const dataView = options.dataViews?.[0];
        if (!dataView) return;

        const defaultColor = this.formattingSettings?.polygonConfig?.defaultFillColor?.value?.value || "#3b82f6";
        const invertCoords = this.formattingSettings?.mapConfig?.invertCoordinates?.value ?? false;
        const showWktInTooltip = this.formattingSettings?.tooltipConfig?.showWktInTooltip?.value ?? false;

        // 1. Process Categorical DataView
        if (dataView.categorical) {
            const categorical = dataView.categorical;
            const categories = categorical.categories || [];
            const values = categorical.values;

            const wktCategories: powerbi.DataViewCategoryColumn[] = [];
            const catCategories: powerbi.DataViewCategoryColumn[] = [];

            for (const cat of categories) {
                if (cat.source.roles && cat.source.roles["wkt"]) {
                    wktCategories.push(cat);
                } else if (cat.source.roles && cat.source.roles["category"]) {
                    catCategories.push(cat);
                }
            }

            if (wktCategories.length === 0 && categories.length > 0) {
                for (const cat of categories) {
                    const sample = String(cat.values[0] ?? "").trim().toUpperCase();
                    if (sample.startsWith("POLYGON") || sample.startsWith("MULTIPOLYGON")) {
                        wktCategories.push(cat);
                    }
                }
                if (wktCategories.length === 0) {
                    wktCategories.push(categories[0]);
                }
            }

            if (catCategories.length === 0 && categories.length > wktCategories.length) {
                for (const cat of categories) {
                    if (!wktCategories.includes(cat)) {
                        catCategories.push(cat);
                    }
                }
            }

            let fillColorCol: powerbi.DataViewValueColumn | undefined;
            let polygonSizeCol: powerbi.DataViewValueColumn | undefined;
            const extraTooltipCols: powerbi.DataViewValueColumn[] = [];
            let highlightArray: powerbi.PrimitiveValue[] | undefined;

            if (values) {
                for (const v of values) {
                    if (v.highlights && v.highlights.length > 0) {
                        this.hasExternalHighlights = true;
                        if (!highlightArray) {
                            highlightArray = v.highlights;
                        }
                    }
                    if (v.source.roles && v.source.roles["fillColor"]) {
                        fillColorCol = v;
                    } else if (v.source.roles && v.source.roles["polygonSize"]) {
                        polygonSizeCol = v;
                    } else {
                        extraTooltipCols.push(v);
                    }
                }
            }

            const multiLayers = wktCategories.length > 1;

            for (let k = 0; k < wktCategories.length; k++) {
                const wktCat = wktCategories[k];
                const layerId = wktCat.source.queryName || `layer_${k}`;
                const layerName = wktCat.source.displayName || `Camada ${k + 1}`;
                const layerDefaultColor = multiLayers
                    ? LAYER_PALETTE[k % LAYER_PALETTE.length]
                    : defaultColor;

                const isVisible = this.layerVisibilityState.has(layerId)
                    ? this.layerVisibilityState.get(layerId)!
                    : true;

                const featureGroup = L.featureGroup();
                const layerConfig: LayerConfig = {
                    id: layerId,
                    name: layerName,
                    color: layerDefaultColor,
                    visible: isVisible,
                    count: 0,
                    leafletLayer: featureGroup,
                    leafletGroup: featureGroup,
                    type: "wkt",
                    layerIndex: k
                };

                this.layers.set(layerId, layerConfig);

                const rowCount = wktCat.values.length;
                const selectionBaseCol = catCategories[k] || catCategories[0] || wktCat;

                for (let i = 0; i < rowCount; i++) {
                    const uniqueKey = `${layerId}::${i}`;
                    const cachedItem = prevItemsByKey.get(uniqueKey);
                    if (cachedItem) {
                        cachedItem.geoJsonLayer = undefined;
                        cachedItem.layer = undefined;
                        this.items.push(cachedItem);
                        layerConfig.count++;
                        continue;
                    }

                    const rawWkt = String(wktCat.values[i] ?? "").trim();
                    if (!rawWkt || rawWkt === "null" || rawWkt === "undefined") continue;

                    let categoryName = "";
                    if (catCategories[k] && catCategories[k].values[i] != null) {
                        categoryName = String(catCategories[k].values[i]);
                    } else if (catCategories[0] && catCategories[0].values[i] != null) {
                        categoryName = String(catCategories[0].values[i]);
                    } else {
                        categoryName = `${layerName} #${i + 1}`;
                    }

                    const rawCustomFill = fillColorCol ? String(fillColorCol.values[i] ?? "").trim() : "";
                    const customFillColor = (rawCustomFill && rawCustomFill.length > 0 && rawCustomFill !== "null")
                        ? rawCustomFill
                        : "";
                    const color = customFillColor || layerDefaultColor;

                    const builder = this.host.createSelectionIdBuilder()
                        .withCategory(selectionBaseCol, i);
                    const selectionId = builder.createSelectionId();

                    const isRowHighlighted = highlightArray
                        ? (highlightArray[i] !== null && highlightArray[i] !== undefined)
                        : false;

                    const tooltips: VisualTooltipDataItem[] = [];

                    if (multiLayers) {
                        tooltips.push({
                            displayName: "Camada",
                            value: layerName
                        });
                    }

                    tooltips.push({
                        displayName: (catCategories[k] || catCategories[0])?.source?.displayName || "Nome / Categoria",
                        value: categoryName
                    });

                    let sizeVal: number | undefined;
                    if (polygonSizeCol && polygonSizeCol.values[i] != null) {
                        const parsed = Number(polygonSizeCol.values[i]);
                        if (!isNaN(parsed)) {
                            sizeVal = parsed;
                        }
                    }

                    if (fillColorCol) {
                        tooltips.push({
                            displayName: fillColorCol.source.displayName,
                            value: String(fillColorCol.values[i] ?? "-")
                        });
                    }

                    if (polygonSizeCol) {
                        tooltips.push({
                            displayName: polygonSizeCol.source.displayName || "Tamanho / Área",
                            value: sizeVal != null ? sizeVal.toLocaleString() : String(polygonSizeCol.values[i] ?? "-")
                        });
                    }

                    for (const tCol of extraTooltipCols) {
                        tooltips.push({
                            displayName: tCol.source.displayName,
                            value: String(tCol.values[i] ?? "-")
                        });
                    }

                    if (showWktInTooltip) {
                        tooltips.push({
                            displayName: "WKT",
                            value: rawWkt.length > 80 ? rawWkt.substring(0, 77) + "..." : rawWkt
                        });
                    }

                    const geom = this.getCachedOrParseWkt(rawWkt, invertCoords);
                    if (geom) {
                        const metrics = this.getCachedGeometryMetrics(rawWkt, invertCoords, geom);
                        if (!metrics) continue;

                        const feature: GeoJSON.Feature<GeoJSON.Geometry, any> = {
                            type: "Feature",
                            id: uniqueKey,
                            geometry: geom,
                            properties: {
                                index: i,
                                layerId: layerId,
                                layerName: layerName,
                                category: categoryName,
                                fillColor: color
                            }
                        };

                        this.items.push({
                            uniqueKey: uniqueKey,
                            selectionKey: selectionId.getKey(),
                            index: i,
                            layerId: layerId,
                            layerName: layerName,
                            layerIndex: k,
                            category: categoryName,
                            wkt: rawWkt,
                            customFillColor: customFillColor,
                            fillColor: color,
                            selectionId: selectionId,
                            isHighlighted: isRowHighlighted,
                            tooltips: tooltips,
                            geoJson: feature,
                            minLat: metrics.minLat,
                            maxLat: metrics.maxLat,
                            minLng: metrics.minLng,
                            maxLng: metrics.maxLng,
                            centerLat: metrics.centerLat,
                            centerLng: metrics.centerLng,
                            labelLat: metrics.labelLat,
                            labelLng: metrics.labelLng,
                            diagonalDegrees: metrics.diagonalDegrees,
                            polygonSize: sizeVal,
                            lastScreenPx: 20
                        });

                        layerConfig.count++;
                    }
                }
            }

            if (this.items.length > 0) return;
        }

        // 2. Fallback: Table Mapping if available
        if (dataView.table && dataView.table.rows && dataView.table.rows.length > 0) {
            const table = dataView.table;
            const columns = table.columns;
            const rows = table.rows;

            const wktColIndices: number[] = [];
            let catColIdx = -1;
            let fillColIdx = -1;
            let sizeColIdx = -1;

            for (let c = 0; c < columns.length; c++) {
                const col = columns[c];
                if (col.roles) {
                    if (col.roles["wkt"]) wktColIndices.push(c);
                    else if (col.roles["category"]) catColIdx = c;
                    else if (col.roles["fillColor"]) fillColIdx = c;
                    else if (col.roles["polygonSize"]) sizeColIdx = c;
                }
            }

            if (wktColIndices.length === 0) {
                for (let c = 0; c < columns.length; c++) {
                    const sample = String(rows[0][c] ?? "").trim().toUpperCase();
                    if (sample.startsWith("POLYGON") || sample.startsWith("MULTIPOLYGON")) {
                        wktColIndices.push(c);
                    }
                }
            }
            if (wktColIndices.length === 0 && columns.length > 0) wktColIndices.push(0);

            const multiLayers = wktColIndices.length > 1;

            for (let k = 0; k < wktColIndices.length; k++) {
                const wColIdx = wktColIndices[k];
                const col = columns[wColIdx];
                const layerId = col.queryName || `layer_${k}`;
                const layerName = col.displayName || `Camada ${k + 1}`;
                const layerColor = multiLayers
                    ? LAYER_PALETTE[k % LAYER_PALETTE.length]
                    : defaultColor;

                const isVisible = this.layerVisibilityState.has(layerId)
                    ? this.layerVisibilityState.get(layerId)!
                    : true;

                const featureGroup = L.featureGroup();
                const layerConfig: LayerConfig = {
                    id: layerId,
                    name: layerName,
                    color: layerColor,
                    visible: isVisible,
                    count: 0,
                    leafletLayer: featureGroup,
                    leafletGroup: featureGroup,
                    type: "wkt",
                    layerIndex: k
                };

                this.layers.set(layerId, layerConfig);

                for (let i = 0; i < rows.length; i++) {
                    const uniqueKey = `${layerId}::${i}`;
                    const row = rows[i];
                    const rawWkt = String(row[wColIdx] ?? "").trim();
                    if (!rawWkt || rawWkt === "null" || rawWkt === "undefined") continue;

                    const categoryName = catColIdx !== -1 ? String(row[catColIdx] ?? `${layerName} #${i + 1}`) : `${layerName} #${i + 1}`;
                    const rawCustomFill = fillColIdx !== -1 ? String(row[fillColIdx] ?? "").trim() : "";
                    const customFillColor = (rawCustomFill && rawCustomFill.length > 0 && rawCustomFill !== "null") ? rawCustomFill : "";
                    const color = customFillColor || layerColor;

                    const selectionId = this.host.createSelectionIdBuilder()
                        .withTable(table, i)
                        .createSelectionId();

                    let sizeVal: number | undefined;
                    if (sizeColIdx !== -1 && row[sizeColIdx] != null) {
                        const parsed = Number(row[sizeColIdx]);
                        if (!isNaN(parsed)) {
                            sizeVal = parsed;
                        }
                    }

                    const tooltips: VisualTooltipDataItem[] = [];
                    if (multiLayers) {
                        tooltips.push({ displayName: "Camada", value: layerName });
                    }
                    tooltips.push({ displayName: catColIdx !== -1 ? columns[catColIdx].displayName : "Categoria", value: categoryName });
                    if (sizeColIdx !== -1) {
                        tooltips.push({
                            displayName: columns[sizeColIdx].displayName || "Tamanho / Área",
                            value: sizeVal != null ? sizeVal.toLocaleString() : String(row[sizeColIdx] ?? "-")
                        });
                    }

                    const geom = this.getCachedOrParseWkt(rawWkt, invertCoords);
                    if (geom) {
                        const metrics = this.getCachedGeometryMetrics(rawWkt, invertCoords, geom);
                        if (!metrics) continue;

                        this.items.push({
                            uniqueKey: uniqueKey,
                            selectionKey: selectionId.getKey(),
                            index: i,
                            layerId: layerId,
                            layerName: layerName,
                            layerIndex: k,
                            category: categoryName,
                            wkt: rawWkt,
                            customFillColor: customFillColor,
                            fillColor: color,
                            selectionId: selectionId,
                            isHighlighted: false,
                            tooltips: tooltips,
                            geoJson: {
                                type: "Feature",
                                id: uniqueKey,
                                geometry: geom,
                                properties: { index: i, layerId, layerName, category: categoryName, fillColor: color }
                            },
                            minLat: metrics.minLat,
                            maxLat: metrics.maxLat,
                            minLng: metrics.minLng,
                            maxLng: metrics.maxLng,
                            centerLat: metrics.centerLat,
                            centerLng: metrics.centerLng,
                            labelLat: metrics.labelLat,
                            labelLng: metrics.labelLng,
                            diagonalDegrees: metrics.diagonalDegrees,
                            polygonSize: sizeVal,
                            lastScreenPx: 20
                        });
                        layerConfig.count++;
                    }
                }
            }
        }
    }

    private getCachedOrParseWkt(rawWkt: string, invertCoords: boolean): GeoJSON.Geometry | null {
        const cacheKey = `${invertCoords ? "inv:" : "std:"}${rawWkt}`;
        if (this.wktCache.has(cacheKey)) {
            return this.wktCache.get(cacheKey)!;
        }

        const geom = this.parseWktToGeoJsonGeometry(rawWkt, invertCoords);

        if (this.wktCache.size > 25000) {
            this.wktCache.clear();
            this.metricsCache.clear();
        }

        this.wktCache.set(cacheKey, geom);
        return geom;
    }

    private getDashArray(style: string): string | undefined {
        switch (style) {
            case "dashed": return "6, 6";
            case "dotted": return "2, 5";
            case "dash-dot": return "8, 4, 2, 4";
            case "solid":
            default: return undefined;
        }
    }

    /**
     * Derives a darker, harmonic border color from a given fill color (Hex or RGB).
     */
    private getDerivedStrokeColor(fillColor: string, fallbackColor: string): string {
        const autoStroke = this.formattingSettings?.polygonConfig?.autoStrokeColor?.value ?? true;
        if (!autoStroke) {
            return fallbackColor;
        }

        if (!fillColor) return fallbackColor;
        if (this.strokeColorCache.has(fillColor)) {
            return this.strokeColorCache.get(fillColor)!;
        }

        let hex = fillColor.trim();
        let r = -1, g = -1, b = -1;

        if (hex.startsWith("#")) {
            hex = hex.slice(1);
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            } else if (hex.length >= 6) {
                r = parseInt(hex.slice(0, 2), 16);
                g = parseInt(hex.slice(2, 4), 16);
                b = parseInt(hex.slice(4, 6), 16);
            }
        } else if (hex.toLowerCase().startsWith("rgb")) {
            const parts = hex.match(/\d+/g);
            if (parts && parts.length >= 3) {
                r = parseInt(parts[0], 10);
                g = parseInt(parts[1], 10);
                b = parseInt(parts[2], 10);
            }
        }

        if (r < 0 || isNaN(r) || isNaN(g) || isNaN(b)) {
            return fallbackColor;
        }

        const factor = 0.68; // 32% darker for clear cartographic contrast
        const dr = Math.max(0, Math.min(255, Math.round(r * factor)));
        const dg = Math.max(0, Math.min(255, Math.round(g * factor)));
        const db = Math.max(0, Math.min(255, Math.round(b * factor)));

        const toHex = (n: number) => n.toString(16).padStart(2, "0");
        const derived = `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
        this.strokeColorCache.set(fillColor, derived);
        return derived;
    }

    private getPolygonCentroid(geom: GeoJSON.Geometry): [number, number] | null {
        if (!geom) return null;
        try {
            let bestRing: number[][] | null = null;
            if (geom.type === "Polygon") {
                bestRing = (geom as GeoJSON.Polygon).coordinates[0];
            } else if (geom.type === "MultiPolygon") {
                const polygons = (geom as GeoJSON.MultiPolygon).coordinates;
                if (polygons && polygons.length > 0) {
                    bestRing = polygons[0][0];
                    let maxSpan = -1;
                    for (let p = 0; p < polygons.length; p++) {
                        const ring = polygons[p][0];
                        if (ring && ring.length > 0) {
                            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                            for (let i = 0; i < ring.length; i++) {
                                if (ring[i][0] < minX) minX = ring[i][0];
                                if (ring[i][0] > maxX) maxX = ring[i][0];
                                if (ring[i][1] < minY) minY = ring[i][1];
                                if (ring[i][1] > maxY) maxY = ring[i][1];
                            }
                            const span = (maxX - minX) * (maxY - minY);
                            if (span > maxSpan) {
                                maxSpan = span;
                                bestRing = ring;
                            }
                        }
                    }
                }
            }

            if (!bestRing || bestRing.length < 3) return null;

            // Shoelace area-weighted polygon centroid
            let areaTwice = 0;
            let cx = 0;
            let cy = 0;
            const n = bestRing.length;

            for (let i = 0; i < n; i++) {
                const [x0, y0] = bestRing[i];
                const [x1, y1] = bestRing[(i + 1) % n];
                const cross = x0 * y1 - x1 * y0;
                areaTwice += cross;
                cx += (x0 + x1) * cross;
                cy += (y0 + y1) * cross;
            }

            if (Math.abs(areaTwice) > 1e-11) {
                const factor = 1 / (3 * areaTwice);
                const centroidLng = cx * factor;
                const centroidLat = cy * factor;
                if (!isNaN(centroidLat) && !isNaN(centroidLng)) {
                    return [centroidLat, centroidLng];
                }
            }

            let sumLng = 0;
            let sumLat = 0;
            for (let i = 0; i < n; i++) {
                sumLng += bestRing[i][0];
                sumLat += bestRing[i][1];
            }
            return [sumLat / n, sumLng / n];
        } catch {
            return null;
        }
    }

    private computeGeometryMetrics(geom: GeoJSON.Geometry): GeometryMetrics | null {
        if (!geom) return null;
        let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;

        const scanCoords = (coords: any) => {
            if (!coords) return;
            if (typeof coords[0] === "number" && typeof coords[1] === "number") {
                const lng = coords[0];
                const lat = coords[1];
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            } else if (Array.isArray(coords)) {
                for (let i = 0; i < coords.length; i++) {
                    scanCoords(coords[i]);
                }
            }
        };

        try {
            scanCoords((geom as any).coordinates);
        } catch {
            return null;
        }

        if (minLng === Infinity || minLat === Infinity) return null;

        const centerLat = (minLat + maxLat) / 2;
        const centerLng = (minLng + maxLng) / 2;
        const dLat = maxLat - minLat;
        const dLng = maxLng - minLng;
        const diagonalDegrees = Math.sqrt(dLat * dLat + dLng * dLng);

        const centroid = this.getPolygonCentroid(geom);
        const labelLat = centroid ? centroid[0] : centerLat;
        const labelLng = centroid ? centroid[1] : centerLng;

        return {
            minLat,
            maxLat,
            minLng,
            maxLng,
            centerLat,
            centerLng,
            labelLat,
            labelLng,
            diagonalDegrees
        };
    }

    private getCachedGeometryMetrics(wkt: string, invertCoords: boolean, geom: GeoJSON.Geometry): GeometryMetrics | null {
        const key = `${invertCoords ? "inv:" : "std:"}${wkt}`;
        if (this.metricsCache.has(key)) {
            return this.metricsCache.get(key)!;
        }
        const metrics = this.computeGeometryMetrics(geom);
        if (this.metricsCache.size > 25000) {
            this.metricsCache.clear();
        }
        if (metrics) {
            this.metricsCache.set(key, metrics);
        }
        return metrics;
    }

    private parseWktToGeoJsonGeometry(rawWkt: string, invertCoords: boolean): GeoJSON.Geometry | null {
        let geom: GeoJSON.Geometry | null = null;

        try {
            if (typeof (wellknown as any) === "function") {
                geom = (wellknown as any)(rawWkt);
            } else if (typeof (wellknown as any).parse === "function") {
                geom = (wellknown as any).parse(rawWkt);
            } else if ((wellknown as any).default && typeof (wellknown as any).default === "function") {
                geom = (wellknown as any).default(rawWkt);
            } else if ((wellknown as any).default?.parse) {
                geom = (wellknown as any).default.parse(rawWkt);
            }
        } catch {
            geom = null;
        }

        if (!geom) {
            geom = this.fallbackParseWkt(rawWkt);
        }

        if (geom && invertCoords) {
            this.invertGeometryCoordinates(geom);
        }

        return geom;
    }

    private fallbackParseWkt(wkt: string): GeoJSON.Geometry | null {
        try {
            const clean = wkt.trim();
            const upper = clean.toUpperCase();

            if (upper.startsWith("POLYGON")) {
                const inner = clean.substring(clean.indexOf("(") + 1, clean.lastIndexOf(")"));
                const ringMatches = inner.match(/\([^()]+\)/g);
                if (ringMatches) {
                    const coordinates: number[][][] = [];
                    for (const ringStr of ringMatches) {
                        const rawCoords = ringStr.replace(/[()]/g, "").trim().split(",");
                        const ring: number[][] = [];
                        for (const ptStr of rawCoords) {
                            const parts = ptStr.trim().split(/\s+/);
                            if (parts.length >= 2) {
                                const lon = parseFloat(parts[0]);
                                const lat = parseFloat(parts[1]);
                                if (!isNaN(lon) && !isNaN(lat)) {
                                    ring.push([lon, lat]);
                                }
                            }
                        }
                        if (ring.length > 0) coordinates.push(ring);
                    }
                    if (coordinates.length > 0) {
                        return { type: "Polygon", coordinates: coordinates };
                    }
                }
            } else if (upper.startsWith("MULTIPOLYGON")) {
                const multiRegex = /\(\s*\([^()]+\)(?:\s*,\s*\([^()]+\))*\s*\)/g;
                const polyMatches = clean.match(multiRegex);
                if (polyMatches) {
                    const multiCoordinates: number[][][][] = [];
                    for (const polyStr of polyMatches) {
                        const ringMatches = polyStr.match(/\([^()]+\)/g);
                        if (ringMatches) {
                            const rings: number[][][] = [];
                            for (const ringStr of ringMatches) {
                                const rawCoords = ringStr.replace(/[()]/g, "").trim().split(",");
                                const ring: number[][] = [];
                                for (const ptStr of rawCoords) {
                                    const parts = ptStr.trim().split(/\s+/);
                                    if (parts.length >= 2) {
                                        const lon = parseFloat(parts[0]);
                                        const lat = parseFloat(parts[1]);
                                        if (!isNaN(lon) && !isNaN(lat)) {
                                            ring.push([lon, lat]);
                                        }
                                    }
                                }
                                if (ring.length > 0) rings.push(ring);
                            }
                            if (rings.length > 0) multiCoordinates.push(rings);
                        }
                    }
                    if (multiCoordinates.length > 0) {
                        return { type: "MultiPolygon", coordinates: multiCoordinates };
                    }
                }
            }
        } catch (err) {
            console.warn("fallbackParseWkt error:", err);
        }
        return null;
    }

    private invertGeometryCoordinates(geometry: GeoJSON.Geometry) {
        if (!geometry || !("coordinates" in geometry)) return;

        const invertCoordsArray = (coords: any): any => {
            if (typeof coords[0] === "number" && typeof coords[1] === "number") {
                return [coords[1], coords[0]];
            }
            return coords.map(invertCoordsArray);
        };

        (geometry as any).coordinates = invertCoordsArray((geometry as any).coordinates);
    }

    private updateExternalLayer() {
        const wmsConfig = this.formattingSettings?.wmsConfig;
        const isEnabled = wmsConfig?.enabled?.value ?? false;
        const rawUrl = (wmsConfig?.url?.value || "").trim();
        const serviceType = ((wmsConfig?.serviceType?.value as string) || "wms").toLowerCase();
        const layerTitle = (wmsConfig?.layerTitle?.value || "").trim() || (
            serviceType === "wms" ? "Camada WMS" : serviceType === "wmts" ? "Camada WMTS" : "Camada WFS"
        );
        const configuredLayer = (wmsConfig?.layerName?.value || "").trim();
        const opacityNum = (wmsConfig?.opacity?.value ?? 80) as number;
        const opacity = Math.max(0, Math.min(100, opacityNum)) / 100;

        const externalLayerId = "external_layer_wms_wfs";

        if (!isEnabled || !rawUrl) {
            if (this.currentWmsLayer && this.map?.hasLayer(this.currentWmsLayer)) {
                this.map.removeLayer(this.currentWmsLayer);
            }
            this.currentWmsLayer = null;
            this.currentWmsKey = "";

            if (this.currentWmtsLayer && this.map?.hasLayer(this.currentWmtsLayer)) {
                this.map.removeLayer(this.currentWmtsLayer);
            }
            this.currentWmtsLayer = null;
            this.currentWmtsKey = "";

            if (this.wfsLayerGroup && this.map?.hasLayer(this.wfsLayerGroup)) {
                this.map.removeLayer(this.wfsLayerGroup);
            }
            this.wfsLayerGroup = null;
            this.cachedWfsUrl = "";
            this.cachedWfsGeoJson = null;

            this.layers.delete(externalLayerId);
            return;
        }

        const isVisible = this.layerVisibilityState.has(externalLayerId)
            ? this.layerVisibilityState.get(externalLayerId)!
            : true;

        if (serviceType === "wms") {
            if (this.wfsLayerGroup && this.map?.hasLayer(this.wfsLayerGroup)) {
                this.map.removeLayer(this.wfsLayerGroup);
            }
            this.wfsLayerGroup = null;

            if (this.currentWmtsLayer && this.map?.hasLayer(this.currentWmtsLayer)) {
                this.map.removeLayer(this.currentWmtsLayer);
            }
            this.currentWmtsLayer = null;
            this.currentWmtsKey = "";

            const wmsFormat = (wmsConfig?.wmsFormat?.value as string) || "image/png";
            const wmsTransparent = wmsConfig?.wmsTransparent?.value ?? true;
            const wmsVersion = (wmsConfig?.wmsVersion?.value as string) || "1.1.1";

            const { baseUrl, layerName, version, format } = this.parseWmsUrl(rawUrl, configuredLayer);
            const finalVersion = version || wmsVersion;
            const finalFormat = format || wmsFormat;

            const wmsKey = `${baseUrl}|${layerName}|${finalVersion}|${finalFormat}|${wmsTransparent}`;

            if (wmsKey !== this.currentWmsKey || !this.currentWmsLayer) {
                if (this.currentWmsLayer && this.map?.hasLayer(this.currentWmsLayer)) {
                    this.map.removeLayer(this.currentWmsLayer);
                }

                this.currentWmsLayer = L.tileLayer.wms(baseUrl, {
                    layers: layerName,
                    format: finalFormat,
                    transparent: wmsTransparent,
                    version: finalVersion,
                    opacity: opacity,
                    maxZoom: 22,
                    zIndex: 250
                });
                this.currentWmsKey = wmsKey;
            } else {
                this.currentWmsLayer.setOpacity(opacity);
            }

            const layerConfig: LayerConfig = {
                id: externalLayerId,
                name: layerTitle,
                color: "#06b6d4",
                visible: isVisible,
                count: 0,
                leafletLayer: this.currentWmsLayer,
                type: "wms",
                layerIndex: 999
            };

            this.layers.set(externalLayerId, layerConfig);
        } else if (serviceType === "wmts") {
            if (this.currentWmsLayer && this.map?.hasLayer(this.currentWmsLayer)) {
                this.map.removeLayer(this.currentWmsLayer);
            }
            this.currentWmsLayer = null;
            this.currentWmsKey = "";

            if (this.wfsLayerGroup && this.map?.hasLayer(this.wfsLayerGroup)) {
                this.map.removeLayer(this.wfsLayerGroup);
            }
            this.wfsLayerGroup = null;

            const wmtsUrlTemplate = this.parseWmtsUrl(rawUrl, configuredLayer);
            const wmtsKey = `${wmtsUrlTemplate}`;

            if (wmtsKey !== this.currentWmtsKey || !this.currentWmtsLayer) {
                if (this.currentWmtsLayer && this.map?.hasLayer(this.currentWmtsLayer)) {
                    this.map.removeLayer(this.currentWmtsLayer);
                }

                this.currentWmtsLayer = L.tileLayer(wmtsUrlTemplate, {
                    opacity: opacity,
                    maxZoom: 22,
                    zIndex: 250
                });
                this.currentWmtsKey = wmtsKey;
            } else {
                this.currentWmtsLayer.setOpacity(opacity);
            }

            const layerConfig: LayerConfig = {
                id: externalLayerId,
                name: layerTitle,
                color: "#0ea5e9",
                visible: isVisible,
                count: 0,
                leafletLayer: this.currentWmtsLayer,
                type: "wmts",
                layerIndex: 999
            };

            this.layers.set(externalLayerId, layerConfig);
        } else {
            if (this.currentWmsLayer && this.map?.hasLayer(this.currentWmsLayer)) {
                this.map.removeLayer(this.currentWmsLayer);
            }
            this.currentWmsLayer = null;
            this.currentWmsKey = "";

            if (this.currentWmtsLayer && this.map?.hasLayer(this.currentWmtsLayer)) {
                this.map.removeLayer(this.currentWmtsLayer);
            }
            this.currentWmtsLayer = null;
            this.currentWmtsKey = "";

            const targetWfsUrl = this.buildWfsUrl(rawUrl, configuredLayer);
            const wfsColor = wmsConfig?.wfsColor?.value?.value || "#8b5cf6";
            const wfsStrokeColor = wmsConfig?.wfsStrokeColor?.value?.value || "#6d28d9";

            if (!this.wfsLayerGroup) {
                this.wfsLayerGroup = L.featureGroup();
            }

            if (targetWfsUrl !== this.cachedWfsUrl) {
                this.cachedWfsUrl = targetWfsUrl;
                this.cachedWfsGeoJson = null;

                if (!this.isFetchingWfs && targetWfsUrl) {
                    this.isFetchingWfs = true;
                    fetch(targetWfsUrl)
                        .then(res => {
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            return res.json();
                        })
                        .then(data => {
                            this.isFetchingWfs = false;
                            this.cachedWfsGeoJson = data;
                            this.populateWfsFeatures(data, layerTitle, wfsColor, wfsStrokeColor, opacity);
                            this.updateLegendCount();
                            this.renderLayerControl();
                        })
                        .catch(err => {
                            this.isFetchingWfs = false;
                            console.warn("WFS fetch error:", err);
                        });
                }
            } else if (this.cachedWfsGeoJson) {
                this.populateWfsFeatures(this.cachedWfsGeoJson, layerTitle, wfsColor, wfsStrokeColor, opacity);
            }

            const featureCount = this.wfsLayerGroup ? this.wfsLayerGroup.getLayers().length : 0;

            const layerConfig: LayerConfig = {
                id: externalLayerId,
                name: layerTitle,
                color: wfsColor,
                visible: isVisible,
                count: featureCount,
                leafletLayer: this.wfsLayerGroup,
                leafletGroup: this.wfsLayerGroup,
                type: "wfs",
                layerIndex: 999
            };

            this.layers.set(externalLayerId, layerConfig);
        }
    }

    private populateWfsFeatures(
        geoJson: any,
        layerTitle: string,
        fillColor: string,
        strokeColor: string,
        opacity: number
    ) {
        if (!this.wfsLayerGroup) return;
        this.wfsLayerGroup.clearLayers();

        const invertCoords = this.formattingSettings?.mapConfig?.invertCoordinates?.value ?? false;

        try {
            const geoLayer = L.geoJSON(geoJson, {
                coordsToLatLng: (coords) => {
                    if (invertCoords) {
                        return L.latLng(coords[0], coords[1]);
                    }
                    return L.latLng(coords[1], coords[0]);
                },
                style: () => ({
                    fillColor: fillColor,
                    fillOpacity: opacity * 0.6,
                    color: strokeColor,
                    weight: 2,
                    opacity: opacity
                }),
                pointToLayer: (_, latlng) => {
                    return L.circleMarker(latlng, {
                        radius: 6,
                        fillColor: fillColor,
                        color: strokeColor,
                        weight: 2,
                        opacity: opacity,
                        fillOpacity: opacity * 0.8
                    });
                },
                onEachFeature: (feature, layer) => {
                    if (feature.properties) {
                        const props = feature.properties;
                        const tooltipItems: VisualTooltipDataItem[] = [
                            { displayName: "Camada", value: layerTitle }
                        ];
                        let count = 0;
                        for (const key of Object.keys(props)) {
                            if (count++ >= 8) break;
                            const val = props[key];
                            if (val !== null && val !== undefined && typeof val !== "object") {
                                tooltipItems.push({ displayName: key, value: String(val) });
                            }
                        }

                        layer.on("mousemove", (e: L.LeafletMouseEvent) => {
                            const showTooltip = this.formattingSettings?.tooltipConfig?.showTooltip?.value ?? true;
                            if (!showTooltip) return;

                            this.tooltipService.show({
                                coordinates: [e.originalEvent.clientX, e.originalEvent.clientY],
                                isTouchEvent: false,
                                dataItems: tooltipItems,
                                identities: []
                            });
                        });

                        layer.on("mouseout", () => {
                            this.tooltipService.hide({
                                isTouchEvent: false,
                                immediately: true
                            });
                        });
                    }
                }
            });

            this.wfsLayerGroup.addLayer(geoLayer);
        } catch (e) {
            console.warn("Error rendering WFS GeoJSON:", e);
        }
    }

    private parseWmsUrl(rawUrl: string, configuredLayer: string): { baseUrl: string; layerName: string; version: string; format: string } {
        let baseUrl = rawUrl.trim();
        let layerName = configuredLayer.trim();
        let version = "";
        let format = "";

        try {
            if (baseUrl.includes("?")) {
                const [base, query] = baseUrl.split("?");
                baseUrl = base;
                const params = new URLSearchParams(query);

                const layersParam = params.get("layers") || params.get("LAYERS") || params.get("Layers");
                if (layersParam && !layerName) {
                    layerName = layersParam;
                }

                const versionParam = params.get("version") || params.get("VERSION") || params.get("Version");
                if (versionParam) {
                    version = versionParam;
                }

                const formatParam = params.get("format") || params.get("FORMAT") || params.get("Format");
                if (formatParam) {
                    format = formatParam;
                }
            }
        } catch {
            // Fallback
        }

        return { baseUrl, layerName, version, format };
    }

    private buildWfsUrl(rawUrl: string, configuredLayer: string): string {
        const cleanUrl = rawUrl.trim();
        if (!cleanUrl) return "";

        try {
            if (cleanUrl.toLowerCase().includes("request=getfeature")) {
                let res = cleanUrl;
                if (!res.toLowerCase().includes("outputformat")) {
                    const sep = res.includes("?") ? "&" : "?";
                    res += `${sep}outputFormat=application/json`;
                }
                if (!res.toLowerCase().includes("srsname")) {
                    res += `&srsName=EPSG:4326`;
                }
                return res;
            }

            const [base, query] = cleanUrl.includes("?") ? cleanUrl.split("?") : [cleanUrl, ""];
            const params = new URLSearchParams(query);

            if (!params.has("service") && !params.has("SERVICE")) params.set("service", "WFS");
            if (!params.has("request") && !params.has("REQUEST")) params.set("request", "GetFeature");
            if (!params.has("version") && !params.has("VERSION")) params.set("version", "1.1.0");
            if (!params.has("outputFormat") && !params.has("OUTPUTFORMAT")) params.set("outputFormat", "application/json");
            if (!params.has("srsName") && !params.has("SRSNAME")) params.set("srsName", "EPSG:4326");

            const layerName = configuredLayer.trim() || params.get("typeName") || params.get("typeNames") || "";
            if (layerName && !params.has("typeName") && !params.has("typeNames")) {
                params.set("typeName", layerName);
            }

            return `${base}?${params.toString()}`;
        } catch {
            return cleanUrl;
        }
    }

    private parseWmtsUrl(rawUrl: string, configuredLayer: string): string {
        const cleanUrl = rawUrl.trim();
        if (!cleanUrl) return "";

        const hasZ = /\{z\}|\{TileMatrix\}/i.test(cleanUrl);
        const hasX = /\{x\}|\{TileCol\}/i.test(cleanUrl);
        const hasY = /\{y\}|\{TileRow\}/i.test(cleanUrl);

        if (hasZ && hasX && hasY) {
            return cleanUrl
                .replace(/\{TileMatrix\}/gi, "{z}")
                .replace(/\{TileCol\}/gi, "{x}")
                .replace(/\{TileRow\}/gi, "{y}");
        }

        try {
            const [base, query] = cleanUrl.includes("?") ? cleanUrl.split("?") : [cleanUrl, ""];
            const params = new URLSearchParams(query);

            const layer = configuredLayer.trim() || params.get("layer") || params.get("LAYER") || "";
            const style = params.get("style") || params.get("STYLE") || "default";
            const tileMatrixSet = params.get("tilematrixset") || params.get("TILEMATRIXSET") || params.get("TileMatrixSet") || "EPSG:3857";
            const format = params.get("format") || params.get("FORMAT") || "image/png";

            params.set("service", "WMTS");
            params.set("request", "GetTile");
            params.set("version", params.get("version") || params.get("VERSION") || "1.0.0");
            if (layer) params.set("layer", layer);
            params.set("style", style);
            params.set("tilematrixset", tileMatrixSet);
            params.set("format", format);

            return `${base}?${params.toString()}&TileMatrix={z}&TileRow={y}&TileCol={x}`;
        } catch {
            return cleanUrl;
        }
    }

    private isItemSelectedOrHighlighted(item: PolygonItem): boolean {
        if (this.selectedUniqueKeys.size > 0) {
            return this.selectedUniqueKeys.has(item.uniqueKey);
        }
        if (this.selectedIds.size > 0) {
            return this.selectedIds.has(item.selectionKey);
        }
        if (this.hasExternalHighlights) {
            return item.isHighlighted;
        }
        return false;
    }

    private hasActiveSelectionOrHighlight(): boolean {
        return this.selectedIds.size > 0 || this.selectedUniqueKeys.size > 0 || this.hasExternalHighlights;
    }

    private renderPolygons(didFilterChange = false) {
        if (!this.map) return;

        const hasExternalLayer = this.layers.has("external_layer_wms_wfs");
        if (this.items.length === 0 && !hasExternalLayer) {
            this.emptyStateElement.style.display = "block";
            this.legendElement.style.display = "none";
            this.toolbarContainer.style.display = "none";
            this.labelLayerGroup.clearLayers();
            return;
        }

        this.emptyStateElement.style.display = "none";
        this.legendElement.style.display = "flex";
        this.toolbarContainer.style.display = "flex";

        this.syncVisibleLayersOnMap();

        // Smart Auto-Fit:
        // 1. Always fit on initial load if autoFit is enabled.
        // 2. Fit when external Power BI visuals filter or highlight data if autoFit & autoFitOnFilter are enabled.
        // 3. NEVER fit on formatting/style changes!
        const autoFit = this.formattingSettings?.mapConfig?.autoFit?.value ?? true;
        const autoFitOnFilter = this.formattingSettings?.mapConfig?.autoFitOnFilter?.value ?? true;

        if (autoFit && !this.hasInitialFitDone && this.items.length > 0) {
            this.fitBoundsToVisibleLayers(true);
            this.hasInitialFitDone = true;
        } else if (autoFit && autoFitOnFilter && didFilterChange && this.items.length > 0 && !this.isFetchingMore) {
            this.fitBoundsToVisibleLayers(true);
        }

        this.updateVisiblePolygons();
        this.renderLabels();
    }

    private createPolygonLeafletLayer(
        item: PolygonItem,
        renderer: L.Renderer | undefined,
        smoothFactorVal: number
    ): L.GeoJSON {
        const fillOpacityVal = ((this.formattingSettings?.polygonConfig?.fillOpacity?.value ?? 60) as number) / 100;
        const rawStrokeColor = this.formattingSettings?.polygonConfig?.strokeColor?.value?.value || "#1d4ed8";
        const effectiveStrokeColor = this.getDerivedStrokeColor(item.fillColor, rawStrokeColor);
        const strokeWidthVal = (this.formattingSettings?.polygonConfig?.strokeWidth?.value ?? 2) as number;
        const strokeOpacityVal = ((this.formattingSettings?.polygonConfig?.strokeOpacity?.value ?? 100) as number) / 100;
        const strokeDashStyle = (this.formattingSettings?.polygonConfig?.strokeDashArray?.value as string) || "solid";
        const dashArrayVal = this.getDashArray(strokeDashStyle);

        const geoJsonLayer = L.geoJSON(item.geoJson, {
            style: () => ({
                renderer: renderer,
                smoothFactor: smoothFactorVal,
                fillColor: item.fillColor,
                fillOpacity: fillOpacityVal,
                color: effectiveStrokeColor,
                weight: strokeWidthVal,
                opacity: strokeOpacityVal,
                dashArray: dashArrayVal
            } as L.PathOptions),
            onEachFeature: (_, layer) => {
                item.layer = layer as L.Path;

                layer.on("click", (e: L.LeafletMouseEvent) => {
                    if (this.isBoxSelectMode || this.isDraggingBox || e.originalEvent.shiftKey) {
                        return;
                    }
                    L.DomEvent.stopPropagation(e);
                    const multiSelect = e.originalEvent.ctrlKey || e.originalEvent.metaKey;

                    this.selectionManager.select(item.selectionId, multiSelect).then((ids: ISelectionId[]) => {
                        this.selectedIds.clear();
                        ids.forEach(id => this.selectedIds.add(id.getKey()));

                        if (!multiSelect) {
                            this.selectedUniqueKeys.clear();
                            if (this.selectedIds.size > 0) {
                                this.selectedUniqueKeys.add(item.uniqueKey);
                            }
                        } else {
                            if (this.selectedUniqueKeys.has(item.uniqueKey)) {
                                this.selectedUniqueKeys.delete(item.uniqueKey);
                            } else {
                                this.selectedUniqueKeys.add(item.uniqueKey);
                            }
                        }

                        this.applySelectionStyles();
                        this.updateLegendCount();
                    });
                });

                // Power BI Context Menu (Drill-through, Show as Table, Include/Exclude)
                layer.on("contextmenu", (e: L.LeafletMouseEvent) => {
                    L.DomEvent.stopPropagation(e);
                    e.originalEvent.preventDefault();
                    this.selectionManager.showContextMenu(item.selectionId, {
                        x: e.originalEvent.clientX,
                        y: e.originalEvent.clientY
                    });
                });

                layer.on("mouseover", () => {
                    const enableHover = this.formattingSettings?.polygonConfig?.enableHover?.value ?? true;
                    if (!enableHover) return;

                    if (this.isItemSelectedOrHighlighted(item)) return;

                    const hoverStrokeColor = this.formattingSettings?.polygonConfig?.hoverStrokeColor?.value?.value || "#2563eb";
                    const hoverStrokeWidth = (this.formattingSettings?.polygonConfig?.hoverStrokeWidth?.value ?? 3) as number;
                    const hoverFillOpacity = ((this.formattingSettings?.polygonConfig?.hoverFillOpacity?.value ?? 80) as number) / 100;
                    const currentDashStyle = (this.formattingSettings?.polygonConfig?.strokeDashArray?.value as string) || "solid";

                    (layer as L.Path).setStyle({
                        color: hoverStrokeColor,
                        weight: hoverStrokeWidth,
                        fillOpacity: hoverFillOpacity,
                        opacity: 1.0,
                        dashArray: this.getDashArray(currentDashStyle)
                    });
                    (layer as L.Path).bringToFront();
                });

                layer.on("mousemove", (e: L.LeafletMouseEvent) => {
                    const showTooltip = this.formattingSettings?.tooltipConfig?.showTooltip?.value ?? true;
                    if (!showTooltip || this.isDraggingBox) return;

                    const now = Date.now();
                    if (now - this.lastTooltipTime < 35) return;
                    this.lastTooltipTime = now;

                    this.tooltipService.show({
                        coordinates: [e.originalEvent.clientX, e.originalEvent.clientY],
                        isTouchEvent: false,
                        dataItems: item.tooltips,
                        identities: [item.selectionId]
                    });
                });

                layer.on("mouseout", () => {
                    this.tooltipService.hide({
                        isTouchEvent: false,
                        immediately: true
                    });

                    const enableHover = this.formattingSettings?.polygonConfig?.enableHover?.value ?? true;
                    if (!enableHover) return;

                    const isActive = this.isItemSelectedOrHighlighted(item);
                    this.resetItemStyle(item, isActive, this.hasActiveSelectionOrHighlight());
                });
            }
        });

        item.geoJsonLayer = geoJsonLayer;
        return geoJsonLayer;
    }

    private updateVisiblePolygons() {
        if (!this.map) return;

        if (this.items.length === 0) {
            this.mountedItems.forEach(item => {
                const lc = this.layers.get(item.layerId);
                if (lc?.leafletGroup && item.geoJsonLayer) {
                    lc.leafletGroup.removeLayer(item.geoJsonLayer);
                }
            });
            this.mountedItems.clear();
            this.currentRenderedCount = 0;
            this.updateLegendCount();
            return;
        }

        const bounds = this.map.getBounds();
        const north = bounds.getNorth();
        const south = bounds.getSouth();
        const east = bounds.getEast();
        const west = bounds.getWest();
        const centerLat = bounds.getCenter().lat;
        const zoom = this.map.getZoom();

        const enableLod = this.formattingSettings?.lodConfig?.enableLod?.value ?? true;
        const minPixelSize = (this.formattingSettings?.lodConfig?.minPixelSize?.value ?? 4) as number;
        const enableCulling = this.formattingSettings?.lodConfig?.enableViewportCulling?.value ?? true;
        const maxPolygons = (this.formattingSettings?.lodConfig?.maxPolygonsOnScreen?.value ?? 10000) as number;

        const pxPerDegLng = (256 * Math.pow(2, zoom) * Math.cos(centerLat * Math.PI / 180)) / 360;
        const pxPerDegLat = (256 * Math.pow(2, zoom)) / 360;

        const candidates: PolygonItem[] = [];

        for (const item of this.items) {
            const layerConfig = this.layers.get(item.layerId);
            if (!layerConfig || !layerConfig.visible) continue;

            const isActive = this.isItemSelectedOrHighlighted(item);
            const widthPx = (item.maxLng - item.minLng) * pxPerDegLng;
            const heightPx = (item.maxLat - item.minLat) * pxPerDegLat;
            const maxDimPx = Math.max(widthPx, heightPx);
            item.lastScreenPx = maxDimPx;

            // 1. Viewport Culling check (always keep selected/highlighted items)
            if (enableCulling && !isActive) {
                const inViewport = !(
                    item.maxLat < south ||
                    item.minLat > north ||
                    item.maxLng < west ||
                    item.minLng > east
                );
                if (!inViewport) continue;
            }

            // 2. Level of Detail (LOD) check: screen pixel size (always keep selected/highlighted items)
            if (enableLod && !isActive) {
                if (maxDimPx < minPixelSize) {
                    continue;
                }
            }

            candidates.push(item);
        }

        // 3. Always sort by polygon area/diagonal descending:
        //    - Guarantees largest polygons are drawn first (background) and smaller inner polygons sit on top (clickable!)
        //    - Also prioritizes largest features when capping at maxPolygons
        candidates.sort((a, b) => {
            const valA = a.polygonSize != null && a.polygonSize > 0 ? a.polygonSize : a.diagonalDegrees;
            const valB = b.polygonSize != null && b.polygonSize > 0 ? b.polygonSize : b.diagonalDegrees;
            return valB - valA;
        });

        const itemsToRender = candidates.length > maxPolygons
            ? candidates.slice(0, maxPolygons)
            : candidates;

        this.currentRenderedCount = itemsToRender.length;

        const renderEngine = (this.formattingSettings?.mapConfig?.renderEngine?.value as string) || "canvas";
        const isCanvas = renderEngine !== "svg";
        const renderer = (isCanvas ? this.canvasRenderer : this.svgRenderer) || undefined;
        const smoothFactorVal = (this.formattingSettings?.mapConfig?.smoothFactor?.value ?? 1.0) as number;
        this.lastRendererType = renderEngine;
        this.lastSmoothFactor = smoothFactorVal;

        const nextItemsSet = new Set<PolygonItem>(itemsToRender);

        // Incremental unmount of items that left viewport/LOD
        this.mountedItems.forEach(item => {
            if (!nextItemsSet.has(item)) {
                const layerConfig = this.layers.get(item.layerId);
                if (layerConfig?.leafletGroup && item.geoJsonLayer) {
                    layerConfig.leafletGroup.removeLayer(item.geoJsonLayer);
                }
                this.mountedItems.delete(item);
            }
        });

        // Incremental mount of items inside viewport/LOD using cached L.GeoJSON instances
        for (const item of itemsToRender) {
            const layerConfig = this.layers.get(item.layerId);
            if (!layerConfig || !layerConfig.leafletGroup) continue;

            if (!item.geoJsonLayer) {
                this.createPolygonLeafletLayer(item, renderer, smoothFactorVal);
            }

            if (!this.mountedItems.has(item) && item.geoJsonLayer) {
                layerConfig.leafletGroup.addLayer(item.geoJsonLayer);
                this.mountedItems.add(item);
            }
        }

        this.applySelectionStyles();
        this.updateLegendCount();
    }

    private renderLayerControl() {
        const showLayerControl = this.formattingSettings?.layerConfig?.showLayerControl?.value ?? true;

        if (!showLayerControl || this.layers.size <= 1) {
            this.layerControlContainer.style.display = "none";
            this.layerControlContainer.textContent = "";
            return;
        }

        this.layerControlContainer.style.display = "block";
        this.layerControlContainer.textContent = "";

        const layersList = Array.from(this.layers.values());
        const totalCount = layersList.length;
        const visibleCount = layersList.filter(l => l.visible).length;

        if (!this.isLayerPanelExpanded) {
            const toggleBtn = document.createElement("button");
            toggleBtn.className = "wkt-layer-toggle-btn";
            toggleBtn.title = "Gerenciar Camadas do Mapa";

            const label = document.createElement("span");
            label.textContent = "Camadas";
            toggleBtn.appendChild(label);

            const badge = document.createElement("span");
            badge.className = "btn-badge";
            badge.textContent = `${visibleCount}/${totalCount}`;
            toggleBtn.appendChild(badge);

            toggleBtn.addEventListener("click", () => {
                this.isLayerPanelExpanded = true;
                this.renderLayerControl();
            });

            this.layerControlContainer.appendChild(toggleBtn);
            return;
        }

        const panel = document.createElement("div");
        panel.className = "wkt-layer-panel";

        const header = document.createElement("div");
        header.className = "wkt-layer-header";

        const titleDiv = document.createElement("div");
        titleDiv.className = "header-title";
        const titleText = document.createElement("span");
        titleText.textContent = "Camadas";
        titleDiv.appendChild(titleText);
        header.appendChild(titleDiv);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "header-actions";

        const allBtn = document.createElement("button");
        allBtn.className = "action-link";
        allBtn.textContent = "Todas";
        allBtn.title = "Exibir todas as camadas";
        allBtn.addEventListener("click", () => this.toggleAllLayers(true));
        actionsDiv.appendChild(allBtn);

        const noneBtn = document.createElement("button");
        noneBtn.className = "action-link";
        noneBtn.textContent = "Nenhuma";
        noneBtn.title = "Ocultar todas as camadas";
        noneBtn.addEventListener("click", () => this.toggleAllLayers(false));
        actionsDiv.appendChild(noneBtn);

        const closeBtn = document.createElement("button");
        closeBtn.className = "close-btn";
        closeBtn.textContent = "×";
        closeBtn.title = "Minimizar seletor de camadas";
        closeBtn.addEventListener("click", () => {
            this.isLayerPanelExpanded = false;
            this.renderLayerControl();
        });
        actionsDiv.appendChild(closeBtn);

        header.appendChild(actionsDiv);
        panel.appendChild(header);

        const listContainer = document.createElement("div");
        listContainer.className = "wkt-layer-list";

        const footerText = document.createElement("div");
        footerText.className = "wkt-layer-footer";
        footerText.textContent = `${visibleCount} de ${totalCount} ativas`;

        for (const layer of layersList) {
            const itemRow = document.createElement("div");
            itemRow.className = `wkt-layer-item ${layer.visible ? "" : "is-disabled"}`;
            itemRow.title = `${layer.name}${layer.count > 0 ? ` (${layer.count} elementos)` : ""}`;

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "layer-checkbox";
            checkbox.checked = layer.visible;

            const swatch = document.createElement("div");
            swatch.className = "layer-swatch";
            swatch.style.backgroundColor = layer.color;

            const infoDiv = document.createElement("div");
            infoDiv.className = "layer-info";

            const nameSpan = document.createElement("span");
            nameSpan.className = "layer-name";
            nameSpan.textContent = layer.name;
            infoDiv.appendChild(nameSpan);

            const countBadge = document.createElement("span");
            countBadge.className = "layer-count";
            if (layer.type === "wms") {
                countBadge.textContent = "WMS";
            } else if (layer.type === "wmts") {
                countBadge.textContent = "WMTS";
            } else if (layer.type === "wfs") {
                countBadge.textContent = layer.count > 0 ? `${layer.count}` : "WFS";
            } else {
                countBadge.textContent = String(layer.count);
            }
            infoDiv.appendChild(countBadge);

            itemRow.appendChild(checkbox);
            itemRow.appendChild(swatch);
            itemRow.appendChild(infoDiv);

            const toggleLayer = () => {
                layer.visible = !layer.visible;
                checkbox.checked = layer.visible;
                this.layerVisibilityState.set(layer.id, layer.visible);

                if (layer.visible) {
                    itemRow.classList.remove("is-disabled");
                    if (this.map && !this.map.hasLayer(layer.leafletLayer)) {
                        layer.leafletLayer.addTo(this.map);
                    }
                } else {
                    itemRow.classList.add("is-disabled");
                    if (this.map && this.map.hasLayer(layer.leafletLayer)) {
                        this.map.removeLayer(layer.leafletLayer);
                    }
                }

                this.updateVisiblePolygons();
                this.renderLabels();

                const autoFitOnToggle = this.formattingSettings?.layerConfig?.autoFitOnToggle?.value ?? false;
                if (autoFitOnToggle && layer.visible) {
                    this.fitBoundsToVisibleLayers(false);
                }

                footerText.textContent = `${Array.from(this.layers.values()).filter(l => l.visible).length} de ${totalCount} ativas`;
            };

            checkbox.addEventListener("change", (e) => {
                e.stopPropagation();
                toggleLayer();
            });

            itemRow.addEventListener("click", (e) => {
                if (e.target !== checkbox) {
                    toggleLayer();
                }
            });

            listContainer.appendChild(itemRow);
        }

        panel.appendChild(listContainer);
        panel.appendChild(footerText);

        this.layerControlContainer.appendChild(panel);
    }

    private toggleAllLayers(visible: boolean) {
        this.layers.forEach(layer => {
            layer.visible = visible;
            this.layerVisibilityState.set(layer.id, visible);

            if (this.map) {
                if (visible) {
                    if (!this.map.hasLayer(layer.leafletLayer)) {
                        layer.leafletLayer.addTo(this.map);
                    }
                } else {
                    if (this.map.hasLayer(layer.leafletLayer)) {
                        this.map.removeLayer(layer.leafletLayer);
                    }
                }
            }
        });

        this.updateVisiblePolygons();
        this.renderLabels();
        this.renderLayerControl();

        const autoFitOnToggle = this.formattingSettings?.layerConfig?.autoFitOnToggle?.value ?? false;
        if (autoFitOnToggle && visible) {
            this.fitBoundsToVisibleLayers(false);
        }
    }

    private updateLegendCount() {
        let totalPolygons = 0;
        let activeLayersCount = 0;

        this.layers.forEach(layer => {
            if (layer.visible) {
                totalPolygons += layer.count;
                activeLayersCount++;
            }
        });

        this.legendElement.textContent = "";

        const badge = document.createElement("span");
        badge.className = "legend-badge";
        badge.textContent = this.currentRenderedCount.toLocaleString();
        this.legendElement.appendChild(badge);

        const label = document.createElement("span");
        label.className = "legend-text";
        const isStreaming = this.isFetchingMore;
        const lodActive = this.formattingSettings?.lodConfig?.enableLod?.value ?? true;

        if (totalPolygons > 0) {
            const lodText = lodActive && this.currentRenderedCount < totalPolygons ? " • LOD ativo" : "";
            const streamText = isStreaming ? " • Carregando mais..." : "";
            label.textContent = ` de ${totalPolygons.toLocaleString()} polígonos (${activeLayersCount}/${this.layers.size} camadas)${lodText}${streamText}`;
        } else {
            label.textContent = ` (${activeLayersCount}/${this.layers.size} camadas ativas)`;
        }
        this.legendElement.appendChild(label);

        this.legendElement.title = `${this.currentRenderedCount.toLocaleString()} exibidos de ${totalPolygons.toLocaleString()} polígonos carregados`;

        const selectedCount = this.selectedUniqueKeys.size || this.selectedIds.size;
        if (selectedCount > 0) {
            const clearBtn = document.createElement("button");
            clearBtn.className = "legend-clear-btn";
            clearBtn.type = "button";
            clearBtn.title = "Limpar seleção de polígonos";
            clearBtn.textContent = `${selectedCount} sel. ×`;
            clearBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.clearSelection();
            });
            this.legendElement.appendChild(clearBtn);
        }
    }

    private fitBoundsToVisibleLayers(prioritizeHighlighted = true) {
        if (!this.map) return;

        let combinedBounds: L.LatLngBounds | null = null;
        const focusOnlyActive = prioritizeHighlighted && this.hasActiveSelectionOrHighlight();

        for (const item of this.items) {
            const layerConfig = this.layers.get(item.layerId);
            if (!layerConfig || !layerConfig.visible) continue;
            if (focusOnlyActive && !this.isItemSelectedOrHighlighted(item)) continue;

            const itemBounds = L.latLngBounds(
                L.latLng(item.minLat, item.minLng),
                L.latLng(item.maxLat, item.maxLng)
            );
            if (!combinedBounds) {
                combinedBounds = itemBounds;
            } else {
                combinedBounds.extend(itemBounds);
            }
        }

        // Fallback to all visible items if no highlighted item had valid bounds
        if (!combinedBounds && focusOnlyActive) {
            for (const item of this.items) {
                const layerConfig = this.layers.get(item.layerId);
                if (!layerConfig || !layerConfig.visible) continue;
                const itemBounds = L.latLngBounds(
                    L.latLng(item.minLat, item.minLng),
                    L.latLng(item.maxLat, item.maxLng)
                );
                if (!combinedBounds) combinedBounds = itemBounds;
                else combinedBounds.extend(itemBounds);
            }
        }

        if (this.wfsLayerGroup && this.map.hasLayer(this.wfsLayerGroup) && !focusOnlyActive) {
            const b = this.wfsLayerGroup.getBounds();
            if (b && b.isValid()) {
                if (!combinedBounds) combinedBounds = b;
                else combinedBounds.extend(b);
            }
        }

        if (combinedBounds && (combinedBounds as L.LatLngBounds).isValid()) {
            const isCompact = this.mapContainer.classList.contains("is-compact");
            const pad: [number, number] = isCompact ? [16, 16] : [35, 35];
            this.map.fitBounds(combinedBounds, {
                padding: pad,
                maxZoom: 16
            });
        }
    }

    private resetItemStyle(item: PolygonItem, isActive: boolean, hasSelectionOrHighlight: boolean) {
        if (!item.layer) return;

        const fillOpacityVal = ((this.formattingSettings?.polygonConfig?.fillOpacity?.value ?? 60) as number) / 100;
        const rawStrokeColorVal = this.formattingSettings?.polygonConfig?.strokeColor?.value?.value || "#1d4ed8";
        const effectiveStrokeColor = this.getDerivedStrokeColor(item.fillColor, rawStrokeColorVal);
        const strokeWidthVal = (this.formattingSettings?.polygonConfig?.strokeWidth?.value ?? 2) as number;
        const adaptiveStroke = this.formattingSettings?.polygonConfig?.adaptiveStrokeWidth?.value ?? true;
        const strokeOpacityVal = ((this.formattingSettings?.polygonConfig?.strokeOpacity?.value ?? 100) as number) / 100;
        const highlightColorVal = this.formattingSettings?.polygonConfig?.highlightColor?.value?.value || "#f59e0b";
        const unselectedOpacityVal = ((this.formattingSettings?.polygonConfig?.unselectedOpacity?.value ?? 25) as number) / 100;
        const strokeDashStyle = (this.formattingSettings?.polygonConfig?.strokeDashArray?.value as string) || "solid";
        const dashArrayVal = this.getDashArray(strokeDashStyle);

        // Adaptive border width: scales down smoothly when polygon is tiny on screen
        const adaptiveWeight = (adaptiveStroke && item.lastScreenPx < 14)
            ? Math.max(0.5, Number((strokeWidthVal * (item.lastScreenPx / 16)).toFixed(2)))
            : strokeWidthVal;

        if (hasSelectionOrHighlight) {
            if (isActive) {
                item.layer.setStyle({
                    fillColor: item.fillColor,
                    fillOpacity: Math.min(fillOpacityVal * 1.35, 0.95),
                    color: highlightColorVal,
                    weight: strokeWidthVal + 2,
                    opacity: 1.0,
                    dashArray: dashArrayVal
                });
                item.layer.bringToFront();
            } else {
                item.layer.setStyle({
                    fillColor: item.fillColor,
                    fillOpacity: unselectedOpacityVal,
                    color: effectiveStrokeColor,
                    weight: Math.max(adaptiveWeight * 0.75, 0.5),
                    opacity: 0.3,
                    dashArray: dashArrayVal
                });
            }
        } else {
            item.layer.setStyle({
                fillColor: item.fillColor,
                fillOpacity: fillOpacityVal,
                color: effectiveStrokeColor,
                weight: adaptiveWeight,
                opacity: strokeOpacityVal,
                dashArray: dashArrayVal
            });
        }
    }

    private applySelectionStyles() {
        if (!this.mountedItems.size) return;

        const hasSelectionOrHighlight = this.hasActiveSelectionOrHighlight();
        const activeItems: PolygonItem[] = [];

        this.mountedItems.forEach(item => {
            if (!item.layer) return;
            const isActive = hasSelectionOrHighlight && this.isItemSelectedOrHighlighted(item);
            if (isActive) {
                activeItems.push(item);
            } else {
                this.resetItemStyle(item, false, hasSelectionOrHighlight);
            }
        });

        // Apply active styles last so bringToFront() guarantees selected borders are never occluded
        for (const item of activeItems) {
            this.resetItemStyle(item, true, hasSelectionOrHighlight);
        }
    }

    private renderLabels() {
        this.labelLayerGroup.clearLayers();
        if (!this.map) return;

        const showLabels = this.formattingSettings?.labelConfig?.showLabels?.value ?? false;
        if (!showLabels || this.items.length === 0) return;

        const fontSize = (this.formattingSettings?.labelConfig?.fontSize?.value ?? 10) as number;
        const fontColor = this.formattingSettings?.labelConfig?.fontColor?.value?.value || "#1e293b";
        const minZoom = (this.formattingSettings?.labelConfig?.minZoom?.value ?? 6) as number;
        const avoidCollisions = this.formattingSettings?.labelConfig?.avoidCollisions?.value ?? true;
        const currentZoom = this.map.getZoom();

        if (currentZoom < minZoom) return;

        const bounds = this.map.getBounds();
        const north = bounds.getNorth();
        const south = bounds.getSouth();
        const east = bounds.getEast();
        const west = bounds.getWest();

        const visibleCandidates: PolygonItem[] = [];
        for (const item of this.items) {
            const layerConfig = this.layers.get(item.layerId);
            if (!layerConfig || !layerConfig.visible) continue;

            if (item.maxLat < south || item.minLat > north || item.maxLng < west || item.minLng > east) {
                continue;
            }
            visibleCandidates.push(item);
        }

        // Prioritize selected/highlighted items and larger polygons for labeling
        visibleCandidates.sort((a, b) => {
            const activeA = this.isItemSelectedOrHighlighted(a) ? 1 : 0;
            const activeB = this.isItemSelectedOrHighlighted(b) ? 1 : 0;
            if (activeA !== activeB) return activeB - activeA;
            const valA = a.polygonSize != null && a.polygonSize > 0 ? a.polygonSize : a.diagonalDegrees;
            const valB = b.polygonSize != null && b.polygonSize > 0 ? b.polygonSize : b.diagonalDegrees;
            return valB - valA;
        });

        const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
        let count = 0;
        const maxLabels = 250;

        for (const item of visibleCandidates) {
            if (count >= maxLabels) break;

            const latLng = L.latLng(item.labelLat, item.labelLng);

            if (avoidCollisions) {
                const screenPt = this.map.latLngToContainerPoint(latLng);
                const estWidth = Math.min(180, Math.max(36, item.category.length * (fontSize * 0.68) + 14));
                const estHeight = fontSize * 1.45 + 6;
                const halfW = estWidth / 2;
                const halfH = estHeight / 2;

                const box = {
                    x1: screenPt.x - halfW,
                    y1: screenPt.y - halfH,
                    x2: screenPt.x + halfW,
                    y2: screenPt.y + halfH
                };

                let collides = false;
                for (let j = 0; j < placedBoxes.length; j++) {
                    const b = placedBoxes[j];
                    if (!(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2)) {
                        collides = true;
                        break;
                    }
                }
                if (collides) continue;
                placedBoxes.push(box);
            }

            const labelSpan = document.createElement("span");
            labelSpan.style.fontSize = `${fontSize}pt`;
            labelSpan.style.color = fontColor;
            labelSpan.textContent = item.category;

            const labelIcon = L.divIcon({
                className: "wkt-polygon-label",
                html: labelSpan,
                iconSize: [120, 24],
                iconAnchor: [60, 12]
            });

            const marker = L.marker(latLng, {
                icon: labelIcon,
                interactive: false
            });

            this.labelLayerGroup.addLayer(marker);
            count++;
        }
    }

    private updateLabelsVisibility() {
        this.renderLabels();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
