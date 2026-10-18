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
    type: "wkt" | "wms" | "wfs";
}

interface PolygonItem {
    index: number;
    layerId: string;
    layerName: string;
    category: string;
    wkt: string;
    fillColor: string;
    selectionId: ISelectionId;
    tooltips: VisualTooltipDataItem[];
    geoJson: GeoJSON.Feature<GeoJSON.Geometry, any>;
    layer?: L.Path;
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
    private map: L.Map | null = null;
    private currentTileLayer: L.TileLayer | null = null;
    private currentBasemapKey = "";

    // External Layer (WMS / WFS) properties
    private currentWmsLayer: L.TileLayer.WMS | null = null;
    private currentWmsKey = "";
    private cachedWfsUrl = "";
    private cachedWfsGeoJson: any = null;
    private isFetchingWfs = false;
    private wfsLayerGroup: L.FeatureGroup | null = null;

    private layers: Map<string, LayerConfig> = new Map();
    private layerVisibilityState: Map<string, boolean> = new Map();
    private isLayerPanelExpanded = true;

    private items: PolygonItem[] = [];
    private selectedIds: Set<string> = new Set();
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

        // Prevent Leaflet map click and scroll events inside the layer control
        L.DomEvent.disableClickPropagation(this.layerControlContainer);
        L.DomEvent.disableScrollPropagation(this.layerControlContainer);

        // Bottom status badge
        this.legendElement = document.createElement("div");
        this.legendElement.className = "wkt-map-legend";
        this.legendElement.style.display = "none";
        this.mapContainer.appendChild(this.legendElement);

        this.initLeafletMap(mapCanvas);
    }

    private initLeafletMap(container: HTMLElement) {
        this.map = L.map(container, {
            center: [-15.7801, -47.9292], // Default Brazil
            zoom: 4,
            zoomControl: true,
            attributionControl: true
        });

        this.updateTileLayer("carto-light");

        // Clear selection when clicking map background
        this.map.on("click", (e: L.LeafletMouseEvent) => {
            const originalTarget = e.originalEvent.target as HTMLElement;
            if (originalTarget && originalTarget.classList.contains("leaflet-interactive")) {
                return;
            }
            this.selectionManager.clear().then(() => {
                this.selectedIds.clear();
                this.applySelectionStyles();
            });
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

    public update(options: VisualUpdateOptions) {
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            options.dataViews?.[0]
        );

        if (this.map) {
            setTimeout(() => {
                this.map?.invalidateSize();
            }, 50);
        }

        const selectedBasemap = (this.formattingSettings?.mapConfig?.basemap?.value as string) || "carto-light";
        const customUrl = this.formattingSettings?.mapConfig?.customStyleUrl?.value || "";
        this.updateTileLayer(selectedBasemap, customUrl);

        this.parseData(options);
        this.updateExternalLayer();
        this.renderPolygons();
        this.renderLayerControl();
    }

    private parseData(options: VisualUpdateOptions) {
        this.items = [];
        this.layers.clear();

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

            // Identify role assignment in categories
            for (const cat of categories) {
                if (cat.source.roles && cat.source.roles["wkt"]) {
                    wktCategories.push(cat);
                } else if (cat.source.roles && cat.source.roles["category"]) {
                    catCategories.push(cat);
                }
            }

            // Fallback: If no column had explicit "wkt" role, check samples
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

            // Distinguish categories not bound to WKT
            if (catCategories.length === 0 && categories.length > wktCategories.length) {
                for (const cat of categories) {
                    if (!wktCategories.includes(cat)) {
                        catCategories.push(cat);
                    }
                }
            }

            // Identify fill color and tooltip value columns
            let fillColorCol: powerbi.DataViewValueColumn | undefined;
            const extraTooltipCols: powerbi.DataViewValueColumn[] = [];

            if (values) {
                for (const v of values) {
                    if (v.source.roles && v.source.roles["fillColor"]) {
                        fillColorCol = v;
                    } else {
                        extraTooltipCols.push(v);
                    }
                }
            }

            const multiLayers = wktCategories.length > 1;

            // Process each WKT column as an independent layer
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
                    type: "wkt"
                };

                this.layers.set(layerId, layerConfig);

                const rowCount = wktCat.values.length;
                const selectionBaseCol = catCategories[k] || catCategories[0] || wktCat;

                for (let i = 0; i < rowCount; i++) {
                    const rawWkt = String(wktCat.values[i] ?? "").trim();
                    if (!rawWkt || rawWkt === "null" || rawWkt === "undefined") continue;

                    let categoryName = "";
                    if (catCategories[k] && catCategories[k].values[i]) {
                        categoryName = String(catCategories[k].values[i]);
                    } else if (catCategories[0] && catCategories[0].values[i]) {
                        categoryName = String(catCategories[0].values[i]);
                    } else {
                        categoryName = `${layerName} #${i + 1}`;
                    }

                    const customFill = fillColorCol ? String(fillColorCol.values[i] ?? "").trim() : "";
                    const color = (customFill && customFill.length > 0 && customFill !== "null")
                        ? customFill
                        : layerDefaultColor;

                    const selectionId = this.host.createSelectionIdBuilder()
                        .withCategory(selectionBaseCol, i)
                        .createSelectionId();

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

                    if (fillColorCol) {
                        tooltips.push({
                            displayName: fillColorCol.source.displayName,
                            value: String(fillColorCol.values[i] ?? "-")
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

                    const geom = this.parseWktToGeoJsonGeometry(rawWkt, invertCoords);
                    if (geom) {
                        const feature: GeoJSON.Feature<GeoJSON.Geometry, any> = {
                            type: "Feature",
                            id: `${layerId}_${i}`,
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
                            index: i,
                            layerId: layerId,
                            layerName: layerName,
                            category: categoryName,
                            wkt: rawWkt,
                            fillColor: color,
                            selectionId: selectionId,
                            tooltips: tooltips,
                            geoJson: feature
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
            const tooltipColIndices: number[] = [];

            for (let c = 0; c < columns.length; c++) {
                const col = columns[c];
                if (col.roles) {
                    if (col.roles["wkt"]) wktColIndices.push(c);
                    else if (col.roles["category"]) catColIdx = c;
                    else if (col.roles["fillColor"]) fillColIdx = c;
                    else if (col.roles["tooltips"]) tooltipColIndices.push(c);
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
                    type: "wkt"
                };

                this.layers.set(layerId, layerConfig);

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rawWkt = String(row[wColIdx] ?? "").trim();
                    if (!rawWkt || rawWkt === "null" || rawWkt === "undefined") continue;

                    const categoryName = catColIdx !== -1 ? String(row[catColIdx] ?? `${layerName} #${i + 1}`) : `${layerName} #${i + 1}`;
                    const customFill = fillColIdx !== -1 ? String(row[fillColIdx] ?? "").trim() : "";
                    const color = (customFill && customFill.length > 0 && customFill !== "null") ? customFill : layerColor;

                    const selectionId = this.host.createSelectionIdBuilder()
                        .withTable(table, i)
                        .createSelectionId();

                    const tooltips: VisualTooltipDataItem[] = [];
                    if (multiLayers) {
                        tooltips.push({ displayName: "Camada", value: layerName });
                    }
                    tooltips.push({ displayName: catColIdx !== -1 ? columns[catColIdx].displayName : "Categoria", value: categoryName });

                    const geom = this.parseWktToGeoJsonGeometry(rawWkt, invertCoords);
                    if (geom) {
                        this.items.push({
                            index: i,
                            layerId: layerId,
                            layerName: layerName,
                            category: categoryName,
                            wkt: rawWkt,
                            fillColor: color,
                            selectionId: selectionId,
                            tooltips: tooltips,
                            geoJson: {
                                type: "Feature",
                                id: `${layerId}_${i}`,
                                geometry: geom,
                                properties: { index: i, layerId, layerName, category: categoryName, fillColor: color }
                            }
                        });
                        layerConfig.count++;
                    }
                }
            }
        }
    }

    private parseWktToGeoJsonGeometry(rawWkt: string, invertCoords: boolean): GeoJSON.Geometry | null {
        let geom: GeoJSON.Geometry | null = null;

        // 1. Try wellknown library
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
        } catch (e) {
            geom = null;
        }

        // 2. Built-in resilient regex parser for POLYGON and MULTIPOLYGON
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
                const ringMatches = inner.match(/\([^\(\)]+\)/g);
                if (ringMatches) {
                    const coordinates: number[][][] = [];
                    for (const ringStr of ringMatches) {
                        const rawCoords = ringStr.replace(/[\(\)]/g, "").trim().split(",");
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
                const multiRegex = /\(\s*\([^\(\)]+\)(?:\s*,\s*\([^\(\)]+\))*\s*\)/g;
                const polyMatches = clean.match(multiRegex);
                if (polyMatches) {
                    const multiCoordinates: number[][][][] = [];
                    for (const polyStr of polyMatches) {
                        const ringMatches = polyStr.match(/\([^\(\)]+\)/g);
                        if (ringMatches) {
                            const rings: number[][][] = [];
                            for (const ringStr of ringMatches) {
                                const rawCoords = ringStr.replace(/[\(\)]/g, "").trim().split(",");
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
        const layerTitle = (wmsConfig?.layerTitle?.value || "").trim() || (serviceType === "wms" ? "Camada WMS" : "Camada WFS");
        const configuredLayer = (wmsConfig?.layerName?.value || "").trim();
        const opacityNum = (wmsConfig?.opacity?.value ?? 80) as number;
        const opacity = Math.max(0, Math.min(100, opacityNum)) / 100;

        const externalLayerId = "external_layer_wms_wfs";

        if (!isEnabled || !rawUrl) {
            // Clean up external layers if previously active
            if (this.currentWmsLayer && this.map?.hasLayer(this.currentWmsLayer)) {
                this.map.removeLayer(this.currentWmsLayer);
            }
            this.currentWmsLayer = null;
            this.currentWmsKey = "";

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
            // Clean up WFS if switching types
            if (this.wfsLayerGroup && this.map?.hasLayer(this.wfsLayerGroup)) {
                this.map.removeLayer(this.wfsLayerGroup);
            }
            this.wfsLayerGroup = null;

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
                type: "wms"
            };

            this.layers.set(externalLayerId, layerConfig);
        } else {
            // serviceType === "wfs"
            if (this.currentWmsLayer && this.map?.hasLayer(this.currentWmsLayer)) {
                this.map.removeLayer(this.currentWmsLayer);
            }
            this.currentWmsLayer = null;
            this.currentWmsKey = "";

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
                type: "wfs"
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
        } catch (e) {
            // Fallback
        }

        return { baseUrl, layerName, version, format };
    }

    private buildWfsUrl(rawUrl: string, configuredLayer: string): string {
        let cleanUrl = rawUrl.trim();
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
        } catch (e) {
            return cleanUrl;
        }
    }

    private renderPolygons() {
        if (!this.map) return;

        // Clean previous layer groups from map
        this.layers.forEach(l => {
            if (this.map?.hasLayer(l.leafletLayer)) {
                this.map.removeLayer(l.leafletLayer);
            }
            if (l.type === "wkt" && l.leafletGroup) {
                l.leafletGroup.clearLayers();
            }
        });

        const hasExternalLayer = this.layers.has("external_layer_wms_wfs");
        if (this.items.length === 0 && !hasExternalLayer) {
            this.emptyStateElement.style.display = "block";
            this.legendElement.style.display = "none";
            return;
        }

        this.emptyStateElement.style.display = "none";
        this.legendElement.style.display = "flex";

        const fillOpacityVal = ((this.formattingSettings?.polygonConfig?.fillOpacity?.value ?? 60) as number) / 100;
        const strokeColorVal = this.formattingSettings?.polygonConfig?.strokeColor?.value?.value || "#1d4ed8";
        const strokeWidthVal = (this.formattingSettings?.polygonConfig?.strokeWidth?.value ?? 2) as number;
        const strokeOpacityVal = ((this.formattingSettings?.polygonConfig?.strokeOpacity?.value ?? 100) as number) / 100;

        for (const item of this.items) {
            const layerConfig = this.layers.get(item.layerId);
            if (!layerConfig || !layerConfig.leafletGroup) continue;

            const geoJsonLayer = L.geoJSON(item.geoJson, {
                style: () => ({
                    fillColor: item.fillColor,
                    fillOpacity: fillOpacityVal,
                    color: strokeColorVal,
                    weight: strokeWidthVal,
                    opacity: strokeOpacityVal
                }),
                onEachFeature: (_, layer) => {
                    item.layer = layer as L.Path;

                    layer.on("click", (e: L.LeafletMouseEvent) => {
                        L.DomEvent.stopPropagation(e);
                        const multiSelect = e.originalEvent.ctrlKey || e.originalEvent.shiftKey;

                        this.selectionManager.select(item.selectionId, multiSelect).then((ids: ISelectionId[]) => {
                            this.selectedIds.clear();
                            ids.forEach(id => this.selectedIds.add(id.getKey()));
                            this.applySelectionStyles();
                        });
                    });

                    layer.on("mousemove", (e: L.LeafletMouseEvent) => {
                        const showTooltip = this.formattingSettings?.tooltipConfig?.showTooltip?.value ?? true;
                        if (!showTooltip) return;

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
                    });
                }
            });

            layerConfig.leafletGroup.addLayer(geoJsonLayer);
        }

        // Add visible layers to map
        this.layers.forEach(layer => {
            if (layer.visible && this.map) {
                layer.leafletLayer.addTo(this.map);
            }
        });

        this.applySelectionStyles();
        this.updateLegendCount();

        // Auto Fit on initial load or if enabled
        const autoFit = this.formattingSettings?.mapConfig?.autoFit?.value ?? true;
        if (autoFit && (!this.hasInitialFitDone || this.items.length > 0)) {
            this.fitBoundsToVisibleLayers();
            this.hasInitialFitDone = true;
        }
    }

    private renderLayerControl() {
        const showLayerControl = this.formattingSettings?.layerConfig?.showLayerControl?.value ?? true;

        // Regra: Quando houver apenas 1 camada no mapa (ex: apenas uma coluna WKT no campo e nenhuma camada externa ativa),
        // não mostrar o controle de camadas no mapa.
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
            // Render Compact Floating Button
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

        // Render Expanded Panel
        const panel = document.createElement("div");
        panel.className = "wkt-layer-panel";

        // Header
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

        // Layers List
        const listContainer = document.createElement("div");
        listContainer.className = "wkt-layer-list";

        for (const layer of layersList) {
            const itemRow = document.createElement("div");
            itemRow.className = `wkt-layer-item ${layer.visible ? "" : "is-disabled"}`;
            itemRow.title = `${layer.name}${layer.count > 0 ? ` (${layer.count} elementos)` : ''}`;

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

                this.updateLegendCount();

                const autoFitOnToggle = this.formattingSettings?.layerConfig?.autoFitOnToggle?.value ?? false;
                if (autoFitOnToggle && layer.visible) {
                    this.fitBoundsToVisibleLayers();
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

        // Footer
        const footerText = document.createElement("div");
        footerText.className = "wkt-layer-footer";
        footerText.textContent = `${visibleCount} de ${totalCount} ativas`;
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

        this.updateLegendCount();
        this.renderLayerControl();

        const autoFitOnToggle = this.formattingSettings?.layerConfig?.autoFitOnToggle?.value ?? false;
        if (autoFitOnToggle && visible) {
            this.fitBoundsToVisibleLayers();
        }
    }

    private updateLegendCount() {
        let totalVisiblePolygons = 0;
        let activeLayersCount = 0;

        this.layers.forEach(layer => {
            if (layer.visible) {
                totalVisiblePolygons += layer.count;
                activeLayersCount++;
            }
        });

        this.legendElement.textContent = "";

        const badge = document.createElement("span");
        badge.className = "legend-badge";
        badge.textContent = String(totalVisiblePolygons);
        this.legendElement.appendChild(badge);

        const label = document.createElement("span");
        if (totalVisiblePolygons > 0) {
            label.textContent = ` polígonos visíveis (${activeLayersCount}/${this.layers.size} camadas)`;
        } else {
            label.textContent = ` (${activeLayersCount}/${this.layers.size} camadas ativas)`;
        }
        this.legendElement.appendChild(label);
    }

    private fitBoundsToVisibleLayers() {
        if (!this.map) return;

        let combinedBounds: L.LatLngBounds | null = null;

        this.layers.forEach(layer => {
            if (layer.visible && layer.count > 0 && layer.leafletGroup) {
                const b = layer.leafletGroup.getBounds();
                if (b && b.isValid()) {
                    if (!combinedBounds) {
                        combinedBounds = L.latLngBounds(b.getSouthWest(), b.getNorthEast());
                    } else {
                        combinedBounds.extend(b);
                    }
                }
            }
        });

        if (combinedBounds && (combinedBounds as L.LatLngBounds).isValid()) {
            this.map.fitBounds(combinedBounds, {
                padding: [35, 35],
                maxZoom: 16
            });
        }
    }

    private applySelectionStyles() {
        if (!this.items.length) return;

        const hasSelection = this.selectedIds.size > 0;
        const fillOpacityVal = ((this.formattingSettings?.polygonConfig?.fillOpacity?.value ?? 60) as number) / 100;
        const strokeColorVal = this.formattingSettings?.polygonConfig?.strokeColor?.value?.value || "#1d4ed8";
        const strokeWidthVal = (this.formattingSettings?.polygonConfig?.strokeWidth?.value ?? 2) as number;
        const strokeOpacityVal = ((this.formattingSettings?.polygonConfig?.strokeOpacity?.value ?? 100) as number) / 100;
        const highlightColorVal = this.formattingSettings?.polygonConfig?.highlightColor?.value?.value || "#f59e0b";
        const unselectedOpacityVal = ((this.formattingSettings?.polygonConfig?.unselectedOpacity?.value ?? 25) as number) / 100;

        for (const item of this.items) {
            if (!item.layer) continue;

            const isSelected = this.selectedIds.has(item.selectionId.getKey());

            if (hasSelection) {
                if (isSelected) {
                    item.layer.setStyle({
                        fillColor: item.fillColor,
                        fillOpacity: Math.min(fillOpacityVal * 1.3, 1.0),
                        color: highlightColorVal,
                        weight: strokeWidthVal + 2,
                        opacity: 1.0
                    });
                } else {
                    item.layer.setStyle({
                        fillColor: item.fillColor,
                        fillOpacity: unselectedOpacityVal,
                        color: strokeColorVal,
                        weight: Math.max(strokeWidthVal - 0.5, 1),
                        opacity: 0.3
                    });
                }
            } else {
                item.layer.setStyle({
                    fillColor: item.fillColor,
                    fillOpacity: fillOpacityVal,
                    color: strokeColorVal,
                    weight: strokeWidthVal,
                    opacity: strokeOpacityVal
                });
            }
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}