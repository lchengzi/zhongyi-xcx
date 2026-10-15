Component({
  properties: {
    interactionVersion: { type: Number, value: 0 },
    favoritesAvailable: { type: Boolean, value: true },
    compareAvailable: { type: Boolean, value: true },
    item: {
      type: Object,
      value: {}
    },
    compact: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    openDetail() {
      this.triggerEvent("detail", { id: this.data.item.id, interactionVersion: this.data.interactionVersion });
    },

    toggleFavorite() {
      if (this.data.favoritesAvailable === false) return;
      this.triggerEvent("favorite", { id: this.data.item.id, interactionVersion: this.data.interactionVersion });
    },

    toggleCompare() {
      if (this.data.compareAvailable === false) return;
      this.triggerEvent("compare", { id: this.data.item.id, interactionVersion: this.data.interactionVersion });
    }
  }
});
