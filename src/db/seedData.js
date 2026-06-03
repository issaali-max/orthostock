// Real orthodontic catalogue parsed from the supplier price list (148 items).
// Prices are WHOLESALE/COST (AED). sellingPriceDefault = suggested ~40% markup; adjust freely.
// Category/product icons are stored here so they are permanent. image_url is ready for product photos.
export const CATALOGUE = [
  {
    "nameAr": "الحاصرات",
    "nameEn": "Brackets",
    "icon": "🦷",
    "color": "#0D3B6E",
    "attributes": [
      {
        "key": "type",
        "labelAr": "النوع",
        "labelEn": "Type",
        "options": [
          "Metal",
          "Ceramic",
          "Sapphire",
          "Gold"
        ]
      },
      {
        "key": "brand",
        "labelAr": "الماركة",
        "labelEn": "Brand",
        "options": [
          "Masel",
          "Xingxing",
          "Fashion"
        ]
      }
    ],
    "products": [
      {
        "nameAr": "حاصرات",
        "nameEn": "Brackets",
        "icon": "🦷",
        "image_url": "",
        "variants": [
          {
            "sku": "BRK-001",
            "nameEn": "metal brackets masel",
            "attributes": {
              "type": "Metal",
              "brand": "Masel"
            },
            "cost": 12.0,
            "selling": 16.8,
            "image_url": ""
          },
          {
            "sku": "BRK-002",
            "nameEn": "metal brackets xingxing",
            "attributes": {
              "type": "Metal",
              "brand": "Xingxing"
            },
            "cost": 5.5,
            "selling": 7.7,
            "image_url": ""
          },
          {
            "sku": "BRK-003",
            "nameEn": "ceramic brackets",
            "attributes": {
              "type": "Ceramic"
            },
            "cost": 11.0,
            "selling": 15.4,
            "image_url": ""
          },
          {
            "sku": "BRK-004",
            "nameEn": "sapphire brackets",
            "attributes": {
              "type": "Sapphire"
            },
            "cost": 184.0,
            "selling": 257.6,
            "image_url": ""
          },
          {
            "sku": "BRK-005",
            "nameEn": "metal brackets fashion",
            "attributes": {
              "type": "Metal",
              "brand": "Fashion"
            },
            "cost": 12.9,
            "selling": 18.1,
            "image_url": ""
          },
          {
            "sku": "BRK-006",
            "nameEn": "gold backets",
            "attributes": {
              "type": "Gold"
            },
            "cost": 29.0,
            "selling": 40.6,
            "image_url": ""
          },
          {
            "sku": "BRK-007",
            "nameEn": "brackets tweezer",
            "attributes": {
              "type": "Metal"
            },
            "cost": 15.0,
            "selling": 21.0,
            "image_url": ""
          }
        ]
      }
    ]
  },
  {
    "nameAr": "الأنابيب والأطواق",
    "nameEn": "Tubes & Bands",
    "icon": "🧷",
    "color": "#0E8C8C",
    "attributes": [
      {
        "key": "order",
        "labelAr": "الترتيب",
        "labelEn": "Order",
        "options": [
          "1st",
          "2nd"
        ]
      },
      {
        "key": "shape",
        "labelAr": "الشكل",
        "labelEn": "Shape",
        "options": [
          "Double",
          "Cross"
        ]
      }
    ],
    "products": [
      {
        "nameAr": "أنبوب شدقي",
        "nameEn": "Buccal Tube",
        "icon": "🧷",
        "image_url": "",
        "variants": [
          {
            "sku": "TUB-001",
            "nameEn": "buccal tube 1st",
            "attributes": {
              "order": "1st"
            },
            "cost": 92.0,
            "selling": 128.8,
            "image_url": ""
          },
          {
            "sku": "TUB-002",
            "nameEn": "buccal tube 2nd",
            "attributes": {
              "order": "2nd"
            },
            "cost": 92.0,
            "selling": 128.8,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "حلقة طاحن",
        "nameEn": "Molar Band",
        "icon": "💍",
        "image_url": "",
        "variants": [
          {
            "sku": "TUB-003",
            "nameEn": "molar band",
            "attributes": {},
            "cost": 1.7,
            "selling": 2.4,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "أنبوب قابل للصق",
        "nameEn": "Bondable Tube",
        "icon": "🧷",
        "image_url": "",
        "variants": [
          {
            "sku": "TUB-004",
            "nameEn": "single bondable mbt",
            "attributes": {},
            "cost": 6.0,
            "selling": 8.4,
            "image_url": ""
          },
          {
            "sku": "TUB-005",
            "nameEn": "sgl bondable mini tube",
            "attributes": {},
            "cost": 5.5,
            "selling": 7.7,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "أنبوب قابل للكبس",
        "nameEn": "Crimpable Tube",
        "icon": "🧷",
        "image_url": "",
        "variants": [
          {
            "sku": "TUB-006",
            "nameEn": "crimpable double tubes",
            "attributes": {
              "shape": "Double"
            },
            "cost": 5.9,
            "selling": 8.3,
            "image_url": ""
          },
          {
            "sku": "TUB-007",
            "nameEn": "crimpable cross tubes",
            "attributes": {
              "shape": "Cross"
            },
            "cost": 5.9,
            "selling": 8.3,
            "image_url": ""
          }
        ]
      }
    ]
  },
  {
    "nameAr": "الأسلاك",
    "nameEn": "Archwires",
    "icon": "〰️",
    "color": "#1A8F52",
    "attributes": [
      {
        "key": "size",
        "labelAr": "المقاس",
        "labelEn": "Size",
        "options": [
          "12",
          "14",
          "16",
          "18",
          "20",
          "16/16",
          "16/22",
          "17/25",
          "18/25",
          "19/25",
          "21/25"
        ]
      },
      {
        "key": "arch",
        "labelAr": "الفك",
        "labelEn": "Arch",
        "options": [
          "Upper",
          "Lower"
        ]
      }
    ],
    "products": [
      {
        "nameAr": "سلك نيتي دائري",
        "nameEn": "NiTi Round Wire",
        "icon": "〰️",
        "image_url": "",
        "variants": [
          {
            "sku": "WIR-001",
            "nameEn": "niti wires round 12 upper",
            "attributes": {
              "size": "12",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-002",
            "nameEn": "niti wires round 12 lower",
            "attributes": {
              "size": "12",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-003",
            "nameEn": "niti wires round 14 upper",
            "attributes": {
              "size": "14",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-004",
            "nameEn": "niti wires round 14 lower",
            "attributes": {
              "size": "14",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-005",
            "nameEn": "niti wires round 16 upper",
            "attributes": {
              "size": "16",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-006",
            "nameEn": "niti wires round 16 lower",
            "attributes": {
              "size": "16",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-007",
            "nameEn": "niti wires round 18 upper",
            "attributes": {
              "size": "18",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-008",
            "nameEn": "niti wires round 18lower",
            "attributes": {
              "size": "18",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-009",
            "nameEn": "niti wires round 20 upper",
            "attributes": {
              "size": "20",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-010",
            "nameEn": "niti wires round 20 lower",
            "attributes": {
              "size": "20",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلك نيتي مستطيل",
        "nameEn": "NiTi Rectangular Wire",
        "icon": "〰️",
        "image_url": "",
        "variants": [
          {
            "sku": "WIR-011",
            "nameEn": "niti wires rectangular 16/16 upper",
            "attributes": {
              "size": "16/16",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-012",
            "nameEn": "niti wires rectangular 16/16 lower",
            "attributes": {
              "size": "16/16",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-013",
            "nameEn": "niti wires rectangular 16/22 upper",
            "attributes": {
              "size": "16/22",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-014",
            "nameEn": "niti wires rectangular 16/22 lower",
            "attributes": {
              "size": "16/22",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-015",
            "nameEn": "niti wires rectangular 17/25 upper",
            "attributes": {
              "size": "17/25",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-016",
            "nameEn": "niti wires rectangular 17/25 lower",
            "attributes": {
              "size": "17/25",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-017",
            "nameEn": "niti wires rectangular 18/25upper",
            "attributes": {
              "size": "18/25",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-018",
            "nameEn": "niti wires rectangular 18/25 lower",
            "attributes": {
              "size": "18/25",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-019",
            "nameEn": "niti wires rectangular 19/25 upper",
            "attributes": {
              "size": "19/25",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-020",
            "nameEn": "niti wires rectangular 19/25 lower",
            "attributes": {
              "size": "19/25",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-021",
            "nameEn": "niti wires rectangular 21/25upper",
            "attributes": {
              "size": "21/25",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-022",
            "nameEn": "niti wires rectangular21/25 lower",
            "attributes": {
              "size": "21/25",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلك ستانلس دائري",
        "nameEn": "Stainless Steel Round Wire",
        "icon": "〰️",
        "image_url": "",
        "variants": [
          {
            "sku": "WIR-023",
            "nameEn": "s.s wires round 12 upper",
            "attributes": {
              "size": "12",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-024",
            "nameEn": "s.s wires round 12 lower",
            "attributes": {
              "size": "12",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-025",
            "nameEn": "s.s wires round 14 upper",
            "attributes": {
              "size": "14",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-026",
            "nameEn": "s.s wires round 14 lower",
            "attributes": {
              "size": "14",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-027",
            "nameEn": "s.s wires round 16 upper",
            "attributes": {
              "size": "16",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-028",
            "nameEn": "s.s wires round 16 lower",
            "attributes": {
              "size": "16",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-029",
            "nameEn": "s.s wires round 18 upper",
            "attributes": {
              "size": "18",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-030",
            "nameEn": "s.s wires round 18 lower",
            "attributes": {
              "size": "18",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-031",
            "nameEn": "s.s wires round 20 upper",
            "attributes": {
              "size": "20",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-032",
            "nameEn": "s.s wires round 20 lower",
            "attributes": {
              "size": "20",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلك ستانلس مستطيل",
        "nameEn": "Stainless Steel Rectangular Wire",
        "icon": "〰️",
        "image_url": "",
        "variants": [
          {
            "sku": "WIR-033",
            "nameEn": "s.s wires rectangular 16/16 upper",
            "attributes": {
              "size": "16/16",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-034",
            "nameEn": "s.s wires rectangular 16/16 lower",
            "attributes": {
              "size": "16/16",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-035",
            "nameEn": "s.s wires rectangular 16/22 upper",
            "attributes": {
              "size": "16/22",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-036",
            "nameEn": "s.s wires rectangular 16/22 lower",
            "attributes": {
              "size": "16/22",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-037",
            "nameEn": "s.s wires rectangular 17/25 upper",
            "attributes": {
              "size": "17/25",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-038",
            "nameEn": "s.s wires rectangular 17/25 lower",
            "attributes": {
              "size": "17/25",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-039",
            "nameEn": "s.s wires rectangular 18/25 upper",
            "attributes": {
              "size": "18/25",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-040",
            "nameEn": "s.s wires rectangular 18/25 lower",
            "attributes": {
              "size": "18/25",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-041",
            "nameEn": "s.s wires rectangular 19/25 upper",
            "attributes": {
              "size": "19/25",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-042",
            "nameEn": "s.s wires rectangular 19/25 lower",
            "attributes": {
              "size": "19/25",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-043",
            "nameEn": "s.s wires rectangular 21/25upper",
            "attributes": {
              "size": "21/25",
              "arch": "Upper"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "WIR-044",
            "nameEn": "s.s wires rectangular21/25 lower",
            "attributes": {
              "size": "21/25",
              "arch": "Lower"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلك نيتي مغلّف دائري",
        "nameEn": "Coated NiTi Round Wire",
        "icon": "〰️",
        "image_url": "",
        "variants": [
          {
            "sku": "WIR-045",
            "nameEn": "coated niti round",
            "attributes": {},
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلك نيتي مغلّف مستطيل",
        "nameEn": "Coated NiTi Rectangular Wire",
        "icon": "〰️",
        "image_url": "",
        "variants": [
          {
            "sku": "WIR-046",
            "nameEn": "coated niti rect",
            "attributes": {},
            "cost": 3.7,
            "selling": 5.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلك ستانلس مغلّف مستطيل",
        "nameEn": "Coated SS Rectangular Wire",
        "icon": "〰️",
        "image_url": "",
        "variants": [
          {
            "sku": "WIR-047",
            "nameEn": "coated staninless steel rect",
            "attributes": {},
            "cost": 3.7,
            "selling": 5.2,
            "image_url": ""
          }
        ]
      }
    ]
  },
  {
    "nameAr": "المطاطات والسلاسل",
    "nameEn": "Elastics & Chains",
    "icon": "🔗",
    "color": "#D97B20",
    "attributes": [
      {
        "key": "size",
        "labelAr": "المقاس",
        "labelEn": "Size",
        "options": [
          "3/16",
          "1/8",
          "1/4",
          "5/16"
        ]
      },
      {
        "key": "force",
        "labelAr": "القوة",
        "labelEn": "Force",
        "options": [
          "M",
          "H"
        ]
      },
      {
        "key": "color",
        "labelAr": "اللون",
        "labelEn": "Color",
        "options": [
          "Silver",
          "Gold"
        ]
      }
    ],
    "products": [
      {
        "nameAr": "رباط تثبيت",
        "nameEn": "Ligature Tie",
        "icon": "🧵",
        "image_url": "",
        "variants": [
          {
            "sku": "ELS-001",
            "nameEn": "ligature tie",
            "attributes": {},
            "cost": 10.0,
            "selling": 14.0,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلسلة مطاطية",
        "nameEn": "Power Chain",
        "icon": "🔗",
        "image_url": "",
        "variants": [
          {
            "sku": "ELS-002",
            "nameEn": "power chain",
            "attributes": {},
            "cost": 10.0,
            "selling": 14.0,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "مطاطات",
        "nameEn": "Elastics",
        "icon": "⭕",
        "image_url": "",
        "variants": [
          {
            "sku": "ELS-003",
            "nameEn": "elastic 3/16 M",
            "attributes": {
              "size": "3/16",
              "force": "M"
            },
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          },
          {
            "sku": "ELS-004",
            "nameEn": "elastic 3/16 H",
            "attributes": {
              "size": "3/16",
              "force": "H"
            },
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          },
          {
            "sku": "ELS-005",
            "nameEn": "elastic 1/8 M",
            "attributes": {
              "size": "1/8",
              "force": "M"
            },
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          },
          {
            "sku": "ELS-006",
            "nameEn": "elastic 1/8 H",
            "attributes": {
              "size": "1/8",
              "force": "H"
            },
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          },
          {
            "sku": "ELS-007",
            "nameEn": "elastic 1/4 M",
            "attributes": {
              "size": "1/4",
              "force": "M"
            },
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          },
          {
            "sku": "ELS-008",
            "nameEn": "elastic 1/4 H",
            "attributes": {
              "size": "1/4",
              "force": "H"
            },
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          },
          {
            "sku": "ELS-009",
            "nameEn": "elastic 5/16 M",
            "attributes": {
              "size": "5/16",
              "force": "M"
            },
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          },
          {
            "sku": "ELS-010",
            "nameEn": "elastic 5/16 H",
            "attributes": {
              "size": "5/16",
              "force": "H"
            },
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          },
          {
            "sku": "ELS-011",
            "nameEn": "elastic placer",
            "attributes": {},
            "cost": 14.0,
            "selling": 19.6,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلسلة أزرار",
        "nameEn": "Button Chain",
        "icon": "🔗",
        "image_url": "",
        "variants": [
          {
            "sku": "ELS-012",
            "nameEn": "silver button chain",
            "attributes": {
              "color": "Silver"
            },
            "cost": 7.4,
            "selling": 10.4,
            "image_url": ""
          },
          {
            "sku": "ELS-013",
            "nameEn": "golden button chain",
            "attributes": {
              "color": "Gold"
            },
            "cost": 9.5,
            "selling": 13.3,
            "image_url": ""
          }
        ]
      }
    ]
  },
  {
    "nameAr": "المستلزمات والملحقات",
    "nameEn": "Auxiliaries & Accessories",
    "icon": "🧰",
    "color": "#8A2D5A",
    "attributes": [],
    "products": [
      {
        "nameAr": "شمع",
        "nameEn": "Wax",
        "icon": "🕯️",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-001",
            "nameEn": "wax",
            "attributes": {},
            "cost": 0.9,
            "selling": 1.3,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "شرائح كاشطة وجهين",
        "nameEn": "Abrasive Strips Doubles Sided",
        "icon": "📏",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-002",
            "nameEn": "abrasive strips doubles sided",
            "attributes": {},
            "cost": 45.0,
            "selling": 63.0,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "شرائح كاشطة وجه واحد",
        "nameEn": "Abrasive Strips Single Sided",
        "icon": "📏",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-003",
            "nameEn": "abrasive strips single sided",
            "attributes": {},
            "cost": 40.0,
            "selling": 56.0,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلك ملتوي",
        "nameEn": "SS Twist Wire",
        "icon": "🌀",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-004",
            "nameEn": "ss twist wire",
            "attributes": {},
            "cost": 11.0,
            "selling": 15.4,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "سلك تثبيت",
        "nameEn": "Retainer Wire",
        "icon": "🛡️",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-005",
            "nameEn": "retainer wire",
            "attributes": {},
            "cost": 11.0,
            "selling": 15.4,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "خيط",
        "nameEn": "Thread",
        "icon": "🧵",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-006",
            "nameEn": "thread",
            "attributes": {},
            "cost": 18.0,
            "selling": 25.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "غلاف",
        "nameEn": "Sleeve",
        "icon": "🧴",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-007",
            "nameEn": "sleeve",
            "attributes": {},
            "cost": 18.0,
            "selling": 25.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "فواصل",
        "nameEn": "Separators",
        "icon": "➗",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-008",
            "nameEn": "separators",
            "attributes": {},
            "cost": 8.5,
            "selling": 11.9,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "إسفين تدوير",
        "nameEn": "Rotation Wedge",
        "icon": "📐",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-009",
            "nameEn": "rotation wedge",
            "attributes": {},
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "مروّض لسان",
        "nameEn": "Tongue Tamer",
        "icon": "👅",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-010",
            "nameEn": "tongue tamer",
            "attributes": {},
            "cost": 8.8,
            "selling": 12.3,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "فاتح عضّة",
        "nameEn": "Bite Opener",
        "icon": "😮",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-011",
            "nameEn": "bite opener",
            "attributes": {},
            "cost": 8.8,
            "selling": 12.3,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "قطع مضغ",
        "nameEn": "Chewies",
        "icon": "🟦",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-012",
            "nameEn": "chewies",
            "attributes": {},
            "cost": 2.2,
            "selling": 3.1,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "مزيل شفاف",
        "nameEn": "Invisible Tooth Removal",
        "icon": "🦷",
        "image_url": "",
        "variants": [
          {
            "sku": "AUX-013",
            "nameEn": "invisible tooth removal",
            "attributes": {},
            "cost": 2.2,
            "selling": 3.1,
            "image_url": ""
          }
        ]
      }
    ]
  },
  {
    "nameAr": "الأزرار والخطافات",
    "nameEn": "Buttons & Hooks",
    "icon": "📎",
    "color": "#6E4DBE",
    "attributes": [
      {
        "key": "length",
        "labelAr": "الطول",
        "labelEn": "Length",
        "options": [
          "Short",
          "Long"
        ]
      },
      {
        "key": "shape",
        "labelAr": "الشكل",
        "labelEn": "Shape",
        "options": [
          "Rectangular"
        ]
      },
      {
        "key": "size",
        "labelAr": "المقاس",
        "labelEn": "Size",
        "options": [
          "Standard",
          "Mini"
        ]
      },
      {
        "key": "hook",
        "labelAr": "الخطاف",
        "labelEn": "Hook",
        "options": [
          "With hook",
          "Without hook"
        ]
      }
    ],
    "products": [
      {
        "nameAr": "خطاف قابل للكبس",
        "nameEn": "Crimpable Hook",
        "icon": "🪝",
        "image_url": "",
        "variants": [
          {
            "sku": "BTN-001",
            "nameEn": "crimpable hook",
            "attributes": {},
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "BTN-019",
            "nameEn": "crimpable hook",
            "attributes": {},
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "BTN-020",
            "nameEn": "crimpable hook with 90 degree bending",
            "attributes": {},
            "cost": 4.4,
            "selling": 6.2,
            "image_url": ""
          },
          {
            "sku": "BTN-021",
            "nameEn": "sliding crimpable hook",
            "attributes": {},
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          },
          {
            "sku": "BTN-022",
            "nameEn": "bondable sliding crimpable hook",
            "attributes": {},
            "cost": 7.4,
            "selling": 10.4,
            "image_url": ""
          },
          {
            "sku": "BTN-023",
            "nameEn": "2 hooks with auxiliary tube",
            "attributes": {},
            "cost": 9.2,
            "selling": 12.9,
            "image_url": ""
          },
          {
            "sku": "BTN-024",
            "nameEn": "crimpable hook with hook",
            "attributes": {},
            "cost": 11.0,
            "selling": 15.4,
            "image_url": ""
          },
          {
            "sku": "BTN-025",
            "nameEn": "y hook",
            "attributes": {},
            "cost": 12.9,
            "selling": 18.1,
            "image_url": ""
          },
          {
            "sku": "BTN-026",
            "nameEn": "long curved crimpable hook",
            "attributes": {},
            "cost": 7.4,
            "selling": 10.4,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "خطاف كوباياشي",
        "nameEn": "Kobayashi Hook",
        "icon": "🪝",
        "image_url": "",
        "variants": [
          {
            "sku": "BTN-002",
            "nameEn": "kobayashi short",
            "attributes": {
              "length": "Short"
            },
            "cost": 14.7,
            "selling": 20.6,
            "image_url": ""
          },
          {
            "sku": "BTN-003",
            "nameEn": "kobayashi long",
            "attributes": {
              "length": "Long"
            },
            "cost": 18.5,
            "selling": 25.9,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "زر لساني",
        "nameEn": "Lingual Button",
        "icon": "🔘",
        "image_url": "",
        "variants": [
          {
            "sku": "BTN-004",
            "nameEn": "lingual button",
            "attributes": {},
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "BTN-005",
            "nameEn": "lingual button with hole",
            "attributes": {},
            "cost": 5.2,
            "selling": 7.3,
            "image_url": ""
          },
          {
            "sku": "BTN-006",
            "nameEn": "lingual button with auxiliary hole",
            "attributes": {},
            "cost": 5.5,
            "selling": 7.7,
            "image_url": ""
          },
          {
            "sku": "BTN-007",
            "nameEn": "lingual button with small cleat",
            "attributes": {},
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "BTN-011",
            "nameEn": "ceramic clear lingual buttons",
            "attributes": {},
            "cost": 11.0,
            "selling": 15.4,
            "image_url": ""
          },
          {
            "sku": "BTN-012",
            "nameEn": "ceramic clear lingual buttons with hook",
            "attributes": {},
            "cost": 29.5,
            "selling": 41.3,
            "image_url": ""
          },
          {
            "sku": "BTN-013",
            "nameEn": "bondable lingual button with hook",
            "attributes": {},
            "cost": 10.5,
            "selling": 14.7,
            "image_url": ""
          },
          {
            "sku": "BTN-014",
            "nameEn": "bondable single tube lingual buttons class l",
            "attributes": {},
            "cost": 22.0,
            "selling": 30.8,
            "image_url": ""
          },
          {
            "sku": "BTN-015",
            "nameEn": "bondable single tube lingual buttons class ll",
            "attributes": {},
            "cost": 22.0,
            "selling": 30.8,
            "image_url": ""
          },
          {
            "sku": "BTN-027",
            "nameEn": "bondable double hooks lingual buttons",
            "attributes": {},
            "cost": 14.8,
            "selling": 20.7,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "عروة لصق مباشر",
        "nameEn": "Direct Bond Eyelet",
        "icon": "⭕",
        "image_url": "",
        "variants": [
          {
            "sku": "BTN-008",
            "nameEn": "direct bond eyelet round",
            "attributes": {
              "shape": "Rectangular"
            },
            "cost": 5.5,
            "selling": 7.7,
            "image_url": ""
          },
          {
            "sku": "BTN-009",
            "nameEn": "direct bond eyelet rectangular",
            "attributes": {
              "shape": "Rectangular"
            },
            "cost": 5.9,
            "selling": 8.3,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "خطاف شد",
        "nameEn": "Traction Hook",
        "icon": "🪝",
        "image_url": "",
        "variants": [
          {
            "sku": "BTN-010",
            "nameEn": "traction hook",
            "attributes": {},
            "cost": 5.9,
            "selling": 8.3,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "مصدّ قابل للكبس",
        "nameEn": "Crimpable Stop",
        "icon": "⏹️",
        "image_url": "",
        "variants": [
          {
            "sku": "BTN-016",
            "nameEn": "crimpable stops",
            "attributes": {
              "size": "Standard"
            },
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          },
          {
            "sku": "BTN-018",
            "nameEn": "crimpable mini stops",
            "attributes": {
              "size": "Mini"
            },
            "cost": 4.4,
            "selling": 6.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "أنبوب زر قابل للصق",
        "nameEn": "Bondable Button Tube",
        "icon": "🧷",
        "image_url": "",
        "variants": [
          {
            "sku": "BTN-017",
            "nameEn": "bondable button tube",
            "attributes": {},
            "cost": 7.4,
            "selling": 10.4,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "قفل مصدّ",
        "nameEn": "Stop Lock",
        "icon": "🔒",
        "image_url": "",
        "variants": [
          {
            "sku": "BTN-028",
            "nameEn": "stop locks with hook",
            "attributes": {
              "hook": "With hook"
            },
            "cost": 22.0,
            "selling": 30.8,
            "image_url": ""
          },
          {
            "sku": "BTN-029",
            "nameEn": "stop locks without hook",
            "attributes": {
              "hook": "Without hook"
            },
            "cost": 11.0,
            "selling": 15.4,
            "image_url": ""
          }
        ]
      }
    ]
  },
  {
    "nameAr": "الأجهزة والزرعات",
    "nameEn": "Appliances & Implants",
    "icon": "🩺",
    "color": "#C93535",
    "attributes": [
      {
        "key": "part",
        "labelAr": "الجزء",
        "labelEn": "Part",
        "options": [
          "Screw",
          "Tool",
          "Positioner"
        ]
      }
    ],
    "products": [
      {
        "nameAr": "قناع وجه",
        "nameEn": "Face Mask",
        "icon": "😷",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-001",
            "nameEn": "face mask",
            "attributes": {},
            "cost": 80.0,
            "selling": 112.0,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "مصدّ شفة",
        "nameEn": "Lip Bumper",
        "icon": "👄",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-002",
            "nameEn": "lip bumper",
            "attributes": {},
            "cost": 7.5,
            "selling": 10.5,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "مثبّت لساني عام",
        "nameEn": "Universal Lingual Retainer",
        "icon": "🛡️",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-003",
            "nameEn": "lingual retainer universal",
            "attributes": {},
            "cost": 18.4,
            "selling": 25.8,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "ملحق تحكم الجذر",
        "nameEn": "Root Control Attachment",
        "icon": "🦷",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-004",
            "nameEn": "root control attachment",
            "attributes": {},
            "cost": 59.0,
            "selling": 82.6,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "جهاز كاريير موشن",
        "nameEn": "Carriere Motion",
        "icon": "🦷",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-005",
            "nameEn": "carriere motion class ll",
            "attributes": {},
            "cost": 92.0,
            "selling": 128.8,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "زرعة دقيقة",
        "nameEn": "Micro Implant",
        "icon": "🔩",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-006",
            "nameEn": "micro implant",
            "attributes": {
              "part": "Screw"
            },
            "cost": 20.0,
            "selling": 28.0,
            "image_url": ""
          },
          {
            "sku": "APP-007",
            "nameEn": "micro implant tool",
            "attributes": {
              "part": "Tool"
            },
            "cost": 100.0,
            "selling": 140.0,
            "image_url": ""
          },
          {
            "sku": "APP-008",
            "nameEn": "micro implant positioner",
            "attributes": {
              "part": "Positioner"
            },
            "cost": 9.2,
            "selling": 12.9,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "شرائح برد السن",
        "nameEn": "IPR Strips",
        "icon": "📏",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-009",
            "nameEn": "interproximal enamel reduction",
            "attributes": {},
            "cost": 14.7,
            "selling": 20.6,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "مبعد خد",
        "nameEn": "Cheek Retractor",
        "icon": "😬",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-010",
            "nameEn": "cheek retractor",
            "attributes": {},
            "cost": 3.0,
            "selling": 4.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "دعامة ذقن",
        "nameEn": "Chin Cup",
        "icon": "🪖",
        "image_url": "",
        "variants": [
          {
            "sku": "APP-011",
            "nameEn": "chin cup",
            "attributes": {},
            "cost": 18.0,
            "selling": 25.2,
            "image_url": ""
          }
        ]
      }
    ]
  },
  {
    "nameAr": "الأدوات والكماشات",
    "nameEn": "Instruments & Pliers",
    "icon": "🔧",
    "color": "#3E5C76",
    "attributes": [
      {
        "key": "gen",
        "labelAr": "الجيل",
        "labelEn": "Gen",
        "options": [
          "1G",
          "2G"
        ]
      }
    ],
    "products": [
      {
        "nameAr": "دافع طواحن",
        "nameEn": "Molar Pusher",
        "icon": "🔧",
        "image_url": "",
        "variants": [
          {
            "sku": "INS-001",
            "nameEn": "molar pusher",
            "attributes": {
              "gen": "1G"
            },
            "cost": 11.0,
            "selling": 15.4,
            "image_url": ""
          },
          {
            "sku": "INS-002",
            "nameEn": "molar pusher 2G",
            "attributes": {
              "gen": "2G"
            },
            "cost": 18.5,
            "selling": 25.9,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "كماشة",
        "nameEn": "Pliers",
        "icon": "🔧",
        "image_url": "",
        "variants": [
          {
            "sku": "INS-003",
            "nameEn": "distal and cutter plier",
            "attributes": {},
            "cost": 70.0,
            "selling": 98.0,
            "image_url": ""
          },
          {
            "sku": "INS-004",
            "nameEn": "ligature cutter plier",
            "attributes": {},
            "cost": 70.0,
            "selling": 98.0,
            "image_url": ""
          },
          {
            "sku": "INS-005",
            "nameEn": "separators piacing plier",
            "attributes": {},
            "cost": 35.0,
            "selling": 49.0,
            "image_url": ""
          },
          {
            "sku": "INS-006",
            "nameEn": "mathieu plier",
            "attributes": {},
            "cost": 15.0,
            "selling": 21.0,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "أداة",
        "nameEn": "Instrument",
        "icon": "🛠️",
        "image_url": "",
        "variants": [
          {
            "sku": "INS-007",
            "nameEn": "band pusher",
            "attributes": {},
            "cost": 10.0,
            "selling": 14.0,
            "image_url": ""
          },
          {
            "sku": "INS-008",
            "nameEn": "gauge",
            "attributes": {},
            "cost": 25.0,
            "selling": 35.0,
            "image_url": ""
          },
          {
            "sku": "INS-010",
            "nameEn": "tucker",
            "attributes": {},
            "cost": 15.0,
            "selling": 21.0,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "ملقط",
        "nameEn": "Tweezers",
        "icon": "🥢",
        "image_url": "",
        "variants": [
          {
            "sku": "INS-009",
            "nameEn": "bucczl tube tweezer",
            "attributes": {},
            "cost": 15.0,
            "selling": 21.0,
            "image_url": ""
          }
        ]
      }
    ]
  },
  {
    "nameAr": "الزنبركات",
    "nameEn": "Springs & Coils",
    "icon": "🌀",
    "color": "#1E73CC",
    "attributes": [
      {
        "key": "eyelet",
        "labelAr": "العروة",
        "labelEn": "Eyelet",
        "options": [
          "Same",
          "Big & small"
        ]
      },
      {
        "key": "length",
        "labelAr": "الطول",
        "labelEn": "Length",
        "options": [
          "3mm",
          "6mm",
          "9mm",
          "12mm"
        ]
      }
    ],
    "products": [
      {
        "nameAr": "زنبرك حرف T",
        "nameEn": "T-Loop",
        "icon": "🌀",
        "image_url": "",
        "variants": [
          {
            "sku": "SPR-001",
            "nameEn": "stainless steel T loop",
            "attributes": {},
            "cost": 18.5,
            "selling": 25.9,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "زنبرك ملف مفتوح",
        "nameEn": "Open Coil Spring",
        "icon": "🌀",
        "image_url": "",
        "variants": [
          {
            "sku": "SPR-002",
            "nameEn": "open coil spring spool",
            "attributes": {},
            "cost": 12.9,
            "selling": 18.1,
            "image_url": ""
          },
          {
            "sku": "SPR-003",
            "nameEn": "open coil spring",
            "attributes": {},
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "زنبرك ملف مغلق",
        "nameEn": "Close Coil Spring",
        "icon": "🌀",
        "image_url": "",
        "variants": [
          {
            "sku": "SPR-004",
            "nameEn": "close coil spring samle eyelets 3 mm",
            "attributes": {
              "eyelet": "Same",
              "length": "3mm"
            },
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          },
          {
            "sku": "SPR-005",
            "nameEn": "close coil spring samle eyelets 6 mm",
            "attributes": {
              "eyelet": "Same",
              "length": "6mm"
            },
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          },
          {
            "sku": "SPR-006",
            "nameEn": "close coil spring samle eyelets 9 mm",
            "attributes": {
              "eyelet": "Same",
              "length": "9mm"
            },
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          },
          {
            "sku": "SPR-007",
            "nameEn": "close coil spring samle eyelets 12 mm",
            "attributes": {
              "eyelet": "Same",
              "length": "12mm"
            },
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          },
          {
            "sku": "SPR-008",
            "nameEn": "close coil spring big and small eyelet 3 mm",
            "attributes": {
              "eyelet": "Big & small",
              "length": "3mm"
            },
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          },
          {
            "sku": "SPR-009",
            "nameEn": "close coil spring big and small eyelet 6 mm",
            "attributes": {
              "eyelet": "Big & small",
              "length": "6mm"
            },
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          },
          {
            "sku": "SPR-010",
            "nameEn": "close coil spring big and small eyelet 12 mm",
            "attributes": {
              "eyelet": "Big & small",
              "length": "12mm"
            },
            "cost": 6.6,
            "selling": 9.2,
            "image_url": ""
          }
        ]
      },
      {
        "nameAr": "زنبرك تدوير",
        "nameEn": "Torque Spring",
        "icon": "🌀",
        "image_url": "",
        "variants": [
          {
            "sku": "SPR-011",
            "nameEn": "torque spring",
            "attributes": {},
            "cost": 10.5,
            "selling": 14.7,
            "image_url": ""
          }
        ]
      }
    ]
  }
];
