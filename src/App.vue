<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="min-vh-100 d-flex flex-column bg-light">
    <!-- Header -->
    <header class="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm">
      <div class="container-fluid">
        <span class="navbar-brand mb-0 h1 fw-bold ps-3">Deskconn</span>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-grow-1 d-flex align-items-center justify-content-center py-4">
      <div class="container">
        <div class="row justify-content-center">
          <div class="col-12 col-md-6 col-lg-5 col-xl-4">
            <!-- Views render the Card content -->
            <RouterView />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style>
/* Global styles if needed, though Bootstrap handles most */
body {
  background-color: #f8f9fa;
}
</style>
